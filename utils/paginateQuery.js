// 7. Utilities
import { escapeRegex } from "./commonUtil.js";

/**
 * @file paginateQuery.js
 * @description Standardized pagination, query parsing, and search filter utilities.
 */

/**
 * Extracts and sanitizes pagination parameters from an Express request query.
 *
 * @param {Record<string, any>} [query={}] - Request query parameters.
 * @returns {{ page: number, limit: number, sort: string, search: string, status: string, skip: number }}
 */
export const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const sort = query.sort || "-createdAt";
  const search = (query.search || "").trim();
  const status = query.status || "";
  return { page, limit, sort, search, status, skip: (page - 1) * limit };
};

/**
 * Constructs a MongoDB `$or` regex filter across multiple target fields.
 *
 * @param {string} search - Search query term.
 * @param {Array<string>} [fields=[]] - Field names to search across.
 * @returns {Record<string, any>} Mongo filter query object.
 */
export const buildSearchFilter = (search, fields = []) => {
  if (!search || !fields.length) return {};
  const regex = new RegExp(escapeRegex(search), "i");
  return { $or: fields.map((field) => ({ [field]: regex })) };
};

/**
 * Formats a paginated response payload.
 *
 * @param {Array<any>} data - Current page data.
 * @param {number} total - Total record count.
 * @param {{ page: number, limit: number }} pagination - Page and limit numbers.
 * @returns {{ data: Array<any>, pagination: { page: number, limit: number, total: number, pages: number } }}
 */
export const paginateResult = (data, total, { page, limit }) => ({
  data,
  pagination: {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  },
});

/**
 * Paginates an in-memory array of items with optional search and status filtering (FallbackDb mode).
 *
 * @param {Array<any>} items - Array of items.
 * @param {Object} options
 * @param {number} options.page - Page number.
 * @param {number} options.limit - Items per page.
 * @param {string} [options.search] - Search term.
 * @param {string} [options.status] - Status filter.
 * @param {Array<string>} [options.searchFields=[]] - Fields to search.
 * @param {string} [options.statusField='status'] - Status field name.
 * @returns {{ data: Array<any>, pagination: Object }}
 */
export const paginateArray = (
  items,
  {
    page,
    limit,
    search,
    status,
    searchFields = [],
    statusField = "status",
  }
) => {
  let filtered = [...items];
  if (search && searchFields.length) {
    const term = search.toLowerCase();
    filtered = filtered.filter((item) =>
      searchFields.some((field) =>
        String(item[field] || "")
          .toLowerCase()
          .includes(term)
      )
    );
  }
  if (status) {
    filtered = filtered.filter((item) => item[statusField] === status);
  }
  const total = filtered.length;
  const data = filtered.slice((page - 1) * limit, page * limit);
  return paginateResult(data, total, { page, limit });
};
