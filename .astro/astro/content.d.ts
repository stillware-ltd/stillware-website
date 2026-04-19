declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"blog": {
"best-apps-for-seniors-easy-to-use-2026.md": {
	id: "best-apps-for-seniors-easy-to-use-2026.md";
  slug: "best-apps-for-seniors-easy-to-use-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-creative-apps-kids-screen-time-alternatives.md": {
	id: "best-creative-apps-kids-screen-time-alternatives.md";
  slug: "best-creative-apps-kids-screen-time-alternatives";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-gamified-chore-tracker-for-kids-no-subscription.md": {
	id: "best-gamified-chore-tracker-for-kids-no-subscription.md";
  slug: "best-gamified-chore-tracker-for-kids-no-subscription";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-budget-app-for-windows.md": {
	id: "best-offline-budget-app-for-windows.md";
  slug: "best-offline-budget-app-for-windows";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-chess-app-for-kids.md": {
	id: "best-offline-chess-app-for-kids.md";
  slug: "best-offline-chess-app-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-chess-puzzles-for-kids.md": {
	id: "best-offline-chess-puzzles-for-kids.md";
  slug: "best-offline-chess-puzzles-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-hiking-journal-apps.md": {
	id: "best-offline-hiking-journal-apps.md";
  slug: "best-offline-hiking-journal-apps";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"budgeting-app-that-works-without-internet.md": {
	id: "budgeting-app-that-works-without-internet.md";
  slug: "budgeting-app-that-works-without-internet";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"envelope-budgeting-app-no-bank-sync.md": {
	id: "envelope-budgeting-app-no-bank-sync.md";
  slug: "envelope-budgeting-app-no-bank-sync";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"hidden-costs-cloud-home-maintenance-log-offline-alternative.md": {
	id: "hidden-costs-cloud-home-maintenance-log-offline-alternative.md";
  slug: "hidden-costs-cloud-home-maintenance-log-offline-alternative";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-protect-kids-data-online-parent-guide.md": {
	id: "how-to-protect-kids-data-online-parent-guide.md";
  slug: "how-to-protect-kids-data-online-parent-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-start-a-rock-collection-for-kids-simple-steps.md": {
	id: "how-to-start-a-rock-collection-for-kids-simple-steps.md";
  slug: "how-to-start-a-rock-collection-for-kids-simple-steps";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-zeroed-encrypts-your-data.md": {
	id: "how-zeroed-encrypts-your-data.md";
  slug: "how-zeroed-encrypts-your-data";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"manual-expense-tracking-2026-mindset-shift.md": {
	id: "manual-expense-tracking-2026-mindset-shift.md";
  slug: "manual-expense-tracking-2026-mindset-shift";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-first-budgeting-apps-compared-2026.md": {
	id: "privacy-first-budgeting-apps-compared-2026.md";
  slug: "privacy-first-budgeting-apps-compared-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-first-budgeting-philosophy.md": {
	id: "privacy-first-budgeting-philosophy.md";
  slug: "privacy-first-budgeting-philosophy";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"subscription-fatigue-software-alternatives.md": {
	id: "subscription-fatigue-software-alternatives.md";
  slug: "subscription-fatigue-software-alternatives";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"true-cost-of-ynab.md": {
	id: "true-cost-of-ynab.md";
  slug: "true-cost-of-ynab";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"what-is-local-first-software-movement-guide-2026.md": {
	id: "what-is-local-first-software-movement-guide-2026.md";
  slug: "what-is-local-first-software-movement-guide-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-kids-deserve-digital-privacy.md": {
	id: "why-kids-deserve-digital-privacy.md";
  slug: "why-kids-deserve-digital-privacy";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-manual-expense-tracking-is-better.md": {
	id: "why-manual-expense-tracking-is-better.md";
  slug: "why-manual-expense-tracking-is-better";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-offline-apps-are-better.md": {
	id: "why-offline-apps-are-better.md";
  slug: "why-offline-apps-are-better";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-we-dont-do-subscriptions.md": {
	id: "why-we-dont-do-subscriptions.md";
  slug: "why-we-dont-do-subscriptions";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"ynab-alternative-no-subscription-ultimate-comparison.md": {
	id: "ynab-alternative-no-subscription-ultimate-comparison.md";
  slug: "ynab-alternative-no-subscription-ultimate-comparison";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"ynab-price-increase-alternatives-2026.md": {
	id: "ynab-price-increase-alternatives-2026.md";
  slug: "ynab-price-increase-alternatives-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"zero-based-budgeting-explained-simply.md": {
	id: "zero-based-budgeting-explained-simply.md";
  slug: "zero-based-budgeting-explained-simply";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("./../../src/content/config.js");
}
