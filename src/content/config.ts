import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date(),
    description: z.string(),
    author: z.string().default('Stillware Team'),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    relatedSlugs: z.array(z.string()).optional(),
    ogImage: z.string().optional(),
    wordCount: z.number().optional(),
    pillar: z.string().optional(),
    appCluster: z.string().optional(),
    primaryKeyword: z.string().optional(),
    qualityScore: z.number().optional(),
    heroImage: z.string().optional(),
  }),
});

export const collections = { blog };
