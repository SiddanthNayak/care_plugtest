import { queryString, request } from "@/apis/request";
import {
  ResourceCategoryRead,
  ResourceCategoryResourceType,
  ResourceCategorySubType,
} from "@/types/base/resourceCategory/resourceCategory";
import { createSlug } from "@/utils/slug";

const normalizeName = (value: string) => value.trim().toLowerCase();

interface UpsertResourceCategoryOptions {
  facilityId: string;
  categories: string[];
  resourceType: ResourceCategoryResourceType;
  slugPrefix: string;
}

export async function upsertResourceCategories({
  facilityId,
  categories,
  resourceType,
  slugPrefix,
}: UpsertResourceCategoryOptions) {
  const normalizedCategoryMap = new Map<string, string>();
  categories
    .map((category) => category.trim())
    .filter(Boolean)
    .forEach((category) => {
      const normalized = normalizeName(category);
      if (!normalizedCategoryMap.has(normalized)) {
        normalizedCategoryMap.set(normalized, category);
      }
    });

  const uniqueCategories = Array.from(normalizedCategoryMap.values());

  if (uniqueCategories.length === 0) {
    return new Map<string, string>();
  }

  const queryParams: Record<string, string | number> = {
    limit: 200,
    resource_type: resourceType,
    resource_sub_type: ResourceCategorySubType.other,
  };

  const existingCategories = (await request(
    `/api/v1/facility/${facilityId}/resource_category/${queryString(queryParams)}`,
    { method: "GET" },
  )) as { results: ResourceCategoryRead[] };

  const existingLookup = new Map<string, string>();
  existingCategories.results.forEach((category) => {
    existingLookup.set(normalizeName(category.title), category.slug);
  });

  const categoryEntries = await Promise.all(
    uniqueCategories.map(async (category) => {
      const slug = await createSlug(category);
      return { category, slug, normalized: normalizeName(category) };
    }),
  );

  const newDatapoints = categoryEntries
    .filter(({ normalized }) => !existingLookup.has(normalized))
    .map(({ category, slug }) => ({ category, slug }));

  if (newDatapoints.length > 0) {
    await request(`/api/v1/facility/${facilityId}/resource_category/upsert/`, {
      method: "POST",
      body: JSON.stringify({
        datapoints: newDatapoints.map(({ category, slug }) => {
          const slugValue = `${slugPrefix}-${slug}`;
          return {
            title: category,
            slug_value: slugValue,
            resource_type: resourceType,
            resource_sub_type: ResourceCategorySubType.other,
          };
        }),
      }),
    });
  }

  const categorySlugMap = new Map<string, string>();
  categoryEntries.forEach(({ slug, normalized }) => {
    const existing = existingLookup.get(normalized);
    if (existing) {
      categorySlugMap.set(normalized, existing);
      return;
    }
    const slugValue = `${slugPrefix}-${slug}`;
    categorySlugMap.set(normalized, `f-${facilityId}-${slugValue}`);
  });

  return categorySlugMap;
}
