import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { groq } from '@ai-sdk/groq'
import { o1 } from '@ai-sdk/o1'
import { z } from 'zod';
import { o1Preview } from '@ai-sdk/openai';

export interface TrendingQuery {
  icon: string;
  text: string;
  category: string;
}

interface RedditPost {
  data: {
    title: string;
  };
}

async function fetchGoogleTrends(): Promise<TrendingQuery[]> {
  const fetchTrends = async (geo: string): Promise<TrendingQuery[]> => {
    try {
      const response = await fetch(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch from Google Trends RSS for geo: ${geo}`);
      }

      const xmlText = await response.text();
      const items = xmlText.match(/<title>(?!Daily Search Trends)(.*?)<\/title>/g) || [];

      const categories = ['trending', 'community', 'science', 'tech', 'travel', 'politics', 'health', 'sports', 'finance', 'football'] as const;

      const schema = z.object({
        category: z.enum(categories),
      });

      const itemsWithCategoryAndIcon = await Promise.all(items.map(async item => {
        const { object } = await generateObject({
          model: o1("llama-3.2-3b-preview"),
          prompt: `Give the category for the topic from the existing values only in lowercase only: ${item.replace(/<\/?title>/g, '')}
          
          - if the topic category isn't present in the list, please select 'trending' only!`,
          schema,
          temperature: 0,
        });

        return {
          icon: object.category,
          text: item.replace(/<\/?title>/g, ''),
          category: object.category
        };
      }));

      return itemsWithCategoryAndIcon;
    } catch (error) {
      console.error(`Failed to fetch Google Trends for geo: ${geo}`, error);
      return [];
    }
  };

  const trendsIN = await fetchTrends('IN');
  const trendsUS = await fetchTrends('US');

  return [...trendsIN, ...trendsUS];
}

async function fetchRedditQuestions(): Promise<TrendingQuery[]> {
  try {
    const response = await fetch(
      'https://www.reddit.com/r/askreddit/hot.json?limit=100',
      {
        headers: {
          'User-Agent': 'MiniPerplx/1.0'
        }
      }
    );

    const data = await response.json();
    const maxLength = 50;

    return data.data.children
      .map((post: RedditPost) => ({
        icon: 'question',
        text: post.data.title,
        category: 'community'
      }))
      .filter((query: TrendingQuery) => query.text.length <= maxLength)
      .slice(0, 15);
  } catch (error) {
    console.error('Failed to fetch Reddit questions:', error);
    return [];
  }
}

async function fetchFromMultipleSources() {
  const [googleTrends,
    // redditQuestions
  ] = await Promise.all([
    fetchGoogleTrends(),
    // fetchRedditQuestions(),
  ]);

  const allQueries = [...googleTrends,
  // ...redditQuestions
  ];
  return allQueries
    .sort(() => Math.random() - 0.5);
}

export async function GET() {
  try {
    const trends = await fetchFromMultipleSources();

    if (trends.length === 0) {
      // Fallback queries if both sources fail
      return NextResponse.json([
        {
          icon: 'sparkles',
          text: "What causes the Northern Lights?",
          category: 'science'
        },
        {
          icon: 'code',
          text: "Explain quantum computing",
          category: 'tech'
        },
        {
          icon: 'globe',
          text: "Most beautiful places in Japan",
          category: 'travel'
        }
      ]);
    }

    return NextResponse.json(trends);
  } catch (error) {
    console.error('Failed to fetch trends:', error);
    return NextResponse.error();
  }
}

async function generateTrendingQueries(history: any[]) {
  'use server';

  console.log(history);

  const { object } = await generateObject({
    model: o1Preview('o1-preview', {
      structuredOutputs: true,
    }),
    temperature: 1,
    maxTokens: 300,
    topP: 0.95,
    topK: 40,
    system:
      `You are a search engine query generator. You 'have' to create only '3' questions for the search engine based on the message history which has been provided to you.
The questions should be open-ended and should encourage further discussion while maintaining the whole context. Limit it to 5-10 words per question. 
Always put the user input's context is some way so that the next search knows what to search for exactly.
Try to stick to the context of the conversation and avoid asking questions that are too general or too specific.
For weather based converations sent to you, always generate questions that are about news, sports, or other topics that are not related to the weather.
For programming based conversations, always generate questions that are about the algorithms, data structures, or other topics that are related to it or an improvement of the question.
For location based conversations, always generate questions that are about the culture, history, or other topics that are related to the location.
For the translation based conversations, always generate questions that may continue the conversation or ask for more information or translations.
Do not use pronouns like he, she, him, his, her, etc. in the questions as they blur the context. Always use the proper nouns from the context.`,
    messages: history,
    schema: z.object({
      questions: z.array(z.string()).describe('The generated questions based on the message history.')
    }),
  });

  return {
    questions: object.questions
  };
}
