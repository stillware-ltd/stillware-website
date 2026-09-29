import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    // Search-result title when the article title is too long or too generic (aim for 60 or fewer; longer is truncated in results). Optional.
    seoTitle: z.string().optional(),
    date: z.date(),
    // Date of the last substantive revision. Emitted as dateModified and article:modified_time; set it whenever an
    // article's facts are refreshed (prices, comparisons, dates), not for typo fixes.
    updated: z.date().optional(),
    description: z.string(),
    author: z.string().default('Stillware Team'),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    relatedSlugs: z.array(z.string()).optional(),
    ogImage: z.string().optional(),
    wordCount: z.number().optional(),
    pillar: z.string().optional(),
    // Only products that ship (or are scheduled) plus "general". An unknown value fails the build, which is the point:
    // the 28 Aug 2026 cleanup removed nine posts whose cluster mapped to no product. Add a product here when it is real.
    appCluster: z.enum(['zeroed', 'rankup-chess', 'held', 'rankup-maths', 'general']).optional(),
    primaryKeyword: z.string().optional(),
    qualityScore: z.number().optional(),
    heroImage: z.string().optional(),
    video: z.string().optional(),        // YouTube id of the companion long video (embed + VideoObject schema)
    videoTitle: z.string().optional(),
  }),
});

export const collections = { blog };
