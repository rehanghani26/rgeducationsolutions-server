export const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const sort = query.sort || '-createdAt';
  const search = (query.search || '').trim();
  const status = query.status || '';
  return { page, limit, sort, search, status, skip: (page - 1) * limit };
};

export const buildSearchFilter = (search, fields = []) => {
  if (!search || !fields.length) return {};
  const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return { $or: fields.map((field) => ({ [field]: regex })) };
};

export const paginateResult = (data, total, { page, limit }) => ({
  data,
  pagination: {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  },
});

export const paginateArray = (items, { page, limit, search, status, searchFields = [], statusField = 'status' }) => {
  let filtered = [...items];
  if (search && searchFields.length) {
    const term = search.toLowerCase();
    filtered = filtered.filter((item) =>
      searchFields.some((field) => String(item[field] || '').toLowerCase().includes(term))
    );
  }
  if (status) {
    filtered = filtered.filter((item) => item[statusField] === status);
  }
  const total = filtered.length;
  const data = filtered.slice((page - 1) * limit, page * limit);
  return paginateResult(data, total, { page, limit });
};
