import { queryString, request } from "./request";
import { PaginatedResponse } from "./types";

export { APIError, formatApiError, queryString, request } from "./request";
export type { PaginatedResponse } from "./types";

export const apis = {
  // ─── Users ───────────────────────────────────────────────────────
  user: {
    getCurrentUser: async () => {
      return await request<{
        username: string;
        facilities: { id: string; name: string }[];
      }>("/api/v1/users/getcurrentuser/", { method: "GET" });
    },

    get: async (username: string) => {
      return await request<{ id: string; username: string }>(
        `/api/v1/users/${username}/`,
        { method: "GET" },
      );
    },

    create: async (body: {
      user_type: string;
      username: string;
      email: string;
      first_name: string;
      last_name: string;
      gender: string;
      password: string;
      phone_number: string;
      geo_organization?: string;
      role_orgs: [];
    }) => {
      return await request("/api/v1/users/", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },

  // ─── Roles ───────────────────────────────────────────────────────
  role: {
    list: async (query?: {
      limit?: number;
      offset?: number;
      name?: string;
    }) => {
      return await request<PaginatedResponse<{ id: string; name: string }>>(
        `/api/v1/role/${queryString(query)}`,
        { method: "GET" },
      );
    },
  },

  // ─── ValueSet ────────────────────────────────────────────────────
  valueset: {
    list: async (query?: { limit?: number; offset?: number }) => {
      return await request<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/valueset/${queryString(query)}`,
        { method: "GET" },
      );
    },

    get: async (slug: string) => {
      return await request<Record<string, unknown>>(
        `/api/v1/valueset/${slug}/`,
        { method: "GET" },
      );
    },

    create: async (body: Record<string, unknown>) => {
      return await request<Record<string, unknown>>("/api/v1/valueset/", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    update: async (slug: string, body: Record<string, unknown>) => {
      return await request<Record<string, unknown>>(
        `/api/v1/valueset/${slug}/`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
    },

    lookupCode: async (body: { system: string; code: string }) => {
      return await request<{ display?: string }>(
        "/api/v1/valueset/lookup_code/",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },
  },

  // ─── Product Knowledge ───────────────────────────────────────────
  productKnowledge: {
    list: async (query?: {
      facility?: string;
      name?: string;
      limit?: number;
      offset?: number;
    }) => {
      return await request<
        PaginatedResponse<{
          name: string;
          slug: string;
          slug_config?: { slug_value: string };
        }>
      >(`/api/v1/product_knowledge/${queryString(query)}`, { method: "GET" });
    },

    get: async (slug: string) => {
      return await request<Record<string, unknown>>(
        `/api/v1/product_knowledge/${slug}/`,
        { method: "GET" },
      );
    },

    create: async (body: Record<string, unknown>) => {
      return await request<{ slug: string }>("/api/v1/product_knowledge/", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    update: async (slug: string, body: Record<string, unknown>) => {
      return await request<Record<string, unknown>>(
        `/api/v1/product_knowledge/${slug}/`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
    },
  },

  // ─── Observation Definition────────────────

  // ─── Facility-scoped resources ───────────────────────────────────
  facility: {
    // ── Location ─────────────────────────────────────────────────
    location: {
      list: async (
        facilityId: string,
        query?: {
          name?: string;
          parent?: string;
          limit?: number;
          offset?: number;
          mode?: string;
          ordering?: string;
          status?: string;
          mine?: boolean;
        },
      ) => {
        return await request<
          PaginatedResponse<{
            id: string;
            name: string;
            form: string;
            has_children: boolean;
            parent?: { id: string; name: string } | null;
          }>
        >(`/api/v1/facility/${facilityId}/location/${queryString(query)}`, {
          method: "GET",
        });
      },

      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request<{ id: string }>(
          `/api/v1/facility/${facilityId}/location/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },

      addOrganizations: async (
        facilityId: string,
        locationId: string,
        body: { organization: string },
      ) => {
        return await request(
          `/api/v1/facility/${facilityId}/location/${locationId}/organizations_add/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },
    },

    // ── Organizations (Departments) ──────────────────────────────
    organizations: {
      list: async (facilityId: string, query?: { limit?: number }) => {
        return await request<PaginatedResponse<{ id: string; name: string }>>(
          `/api/v1/facility/${facilityId}/organizations/${queryString(query)}`,
          { method: "GET" },
        );
      },

      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request<{ id?: string }>(
          `/api/v1/facility/${facilityId}/organizations/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },

      addUser: async (
        facilityId: string,
        organizationId: string,
        body: { user: string; role: string },
      ) => {
        return await request(
          `/api/v1/facility/${facilityId}/organizations/${organizationId}/users/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },
    },

    // ── Activity Definition ──────────────────────────────────────
    activityDefinition: {
      list: async (
        facilityId: string,
        query?: { limit?: number; offset?: number },
      ) => {
        return await request<PaginatedResponse<Record<string, unknown>>>(
          `/api/v1/facility/${facilityId}/activity_definition/${queryString(query)}`,
          { method: "GET" },
        );
      },

      get: async (facilityId: string, slug: string) => {
        return await request<Record<string, unknown>>(
          `/api/v1/facility/${facilityId}/activity_definition/${slug}/`,
          { method: "GET" },
        );
      },

      upsert: async (
        facilityId: string,
        body: { datapoints: Record<string, unknown>[] },
      ) => {
        return await request(
          `/api/v1/facility/${facilityId}/activity_definition/upsert/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },
    },

    // ── Specimen Definition ──────────────────────────────────────
    specimenDefinition: {
      list: async (
        facilityId: string,
        query?: { limit?: number; offset?: number },
      ) => {
        return await request<PaginatedResponse<Record<string, unknown>>>(
          `/api/v1/facility/${facilityId}/specimen_definition/${queryString(query)}`,
          { method: "GET" },
        );
      },

      get: async (facilityId: string, slug: string) => {
        return await request<Record<string, unknown>>(
          `/api/v1/facility/${facilityId}/specimen_definition/${slug}/`,
          { method: "GET" },
        );
      },

      upsert: async (
        facilityId: string,
        body: { datapoints: Record<string, unknown>[] },
      ) => {
        return await request(
          `/api/v1/facility/${facilityId}/specimen_definition/upsert/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },
    },

    observationDefinition: {
      list: async (query?: {
        facility?: string;
        limit?: number;
        offset?: number;
      }) => {
        return await request<PaginatedResponse<Record<string, unknown>>>(
          `/api/v1/observation_definition/${queryString(query)}`,
          { method: "GET" },
        );
      },

      get: async (slug: string, query?: { facility?: string }) => {
        return await request<Record<string, unknown>>(
          `/api/v1/observation_definition/${slug}/${queryString(query)}`,
          { method: "GET" },
        );
      },

      upsert: async (body: { datapoints: Record<string, unknown>[] }) => {
        return await request("/api/v1/observation_definition/upsert/", {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
    },

    // ── Charge Item Definition ───────────────────────────────────
    chargeItemDefinition: {
      list: async (
        facilityId: string,
        query?: { title?: string; limit?: number; offset?: number },
      ) => {
        return await request<
          PaginatedResponse<{ title: string; slug: string }>
        >(
          `/api/v1/facility/${facilityId}/charge_item_definition/${queryString(query)}`,
          { method: "GET" },
        );
      },

      get: async (facilityId: string, slug: string) => {
        return await request<Record<string, unknown>>(
          `/api/v1/facility/${facilityId}/charge_item_definition/${slug}/`,
          { method: "GET" },
        );
      },

      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request<{ slug: string }>(
          `/api/v1/facility/${facilityId}/charge_item_definition/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },

      update: async (
        facilityId: string,
        slug: string,
        body: Record<string, unknown>,
      ) => {
        return await request<Record<string, unknown>>(
          `/api/v1/facility/${facilityId}/charge_item_definition/${slug}/`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          },
        );
      },
    },

    // ── Healthcare Service ───────────────────────────────────────
    healthcareService: {
      list: async (
        facilityId: string,
        query?: { name?: string; limit?: number },
      ) => {
        return await request<PaginatedResponse<{ id: string; name: string }>>(
          `/api/v1/facility/${facilityId}/healthcare_service/${queryString(query)}`,
          { method: "GET" },
        );
      },
    },

    // ── Product ──────────────────────────────────────────────────
    product: {
      list: async (
        facilityId: string,
        query?: { limit?: number; offset?: number },
      ) => {
        return await request<PaginatedResponse<Record<string, unknown>>>(
          `/api/v1/facility/${facilityId}/product/${queryString(query)}`,
          { method: "GET" },
        );
      },

      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request(`/api/v1/facility/${facilityId}/product/`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
    },

    // ── Delivery Order ──────────────────────────────────────────
    deliveryOrder: {
      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request<{ id: string }>(
          `/api/v1/facility/${facilityId}/order/delivery/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },

      update: async (
        facilityId: string,
        orderId: string,
        body: Record<string, unknown>,
      ) => {
        return await request<{ id: string }>(
          `/api/v1/facility/${facilityId}/order/delivery/${orderId}/`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          },
        );
      },
    },

    // ── Resource Category ────────────────────────────────────────
    resourceCategory: {
      list: async (
        facilityId: string,
        query?: {
          limit?: number;
          resource_type?: string;
          resource_sub_type?: string;
        },
      ) => {
        return await request<
          PaginatedResponse<{
            title: string;
            slug: string;
            slug_config: { slug_value: string };
          }>
        >(
          `/api/v1/facility/${facilityId}/resource_category/${queryString(query)}`,
          { method: "GET" },
        );
      },

      create: async (facilityId: string, body: Record<string, unknown>) => {
        return await request(
          `/api/v1/facility/${facilityId}/resource_category/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },

      upsert: async (
        facilityId: string,
        body: { datapoints: Record<string, unknown>[] },
      ) => {
        return await request(
          `/api/v1/facility/${facilityId}/resource_category/upsert/`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      },
    },
  },

  // ─── Supply Delivery (non-facility-scoped) ───────────────────
  supplyDelivery: {
    create: async (body: Record<string, unknown>) => {
      return await request<{ id: string }>("/api/v1/supply_delivery/", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },

  // ─── Organizations ──────────────────────────────────────────
  organization: {
    list: async (query?: {
      org_type?: string;
      name?: string;
      limit?: number;
      offset?: number;
    }) => {
      return await request<PaginatedResponse<{ id: string; name: string }>>(
        `/api/v1/organization/${queryString(query)}`,
        { method: "GET" },
      );
    },
  },
};
