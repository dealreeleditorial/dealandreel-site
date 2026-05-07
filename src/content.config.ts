import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    wordcount: z.number().optional(),
    slug: z.string(),
  }),
});

export const collections = { articles };
