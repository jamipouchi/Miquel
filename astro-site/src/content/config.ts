import { defineCollection } from 'astro:content';

const pages = defineCollection({}); // No schema needed
export const collections = { pages };

