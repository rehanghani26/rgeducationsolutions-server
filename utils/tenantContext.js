import { AsyncLocalStorage } from "node:async_hooks";

/**
 * @file tenantContext.js
 * @description Thread-safe request-scoped tenant context using Node.js AsyncLocalStorage.
 * Stores authenticated schoolId and user information across asynchronous call stacks.
 */

const asyncLocalStorage = new AsyncLocalStorage();

export const tenantContext = {
  /**
   * Runs a function or middleware chain within a scoped tenant context.
   *
   * @param {Object} store - { schoolId: string, user: object, skipTenantFilter: boolean }
   * @param {Function} callback - Function to execute inside this context
   * @returns {*}
   */
  run(store, callback) {
    return asyncLocalStorage.run(store, callback);
  },

  /**
   * Retrieves the current context store.
   *
   * @returns {Object|undefined}
   */
  getStore() {
    return asyncLocalStorage.getStore();
  },

  /**
   * Retrieves the active schoolId for the current asynchronous execution stack.
   *
   * @returns {string|null}
   */
  getSchoolId() {
    const store = asyncLocalStorage.getStore();
    return store?.schoolId || null;
  },

  /**
   * Retrieves the active authenticated user for the current asynchronous execution stack.
   *
   * @returns {Object|null}
   */
  getUser() {
    const store = asyncLocalStorage.getStore();
    return store?.user || null;
  },

  /**
   * Checks whether tenant filtering should be bypassed (e.g. for super platform admin).
   *
   * @returns {boolean}
   */
  isSkipped() {
    const store = asyncLocalStorage.getStore();
    return Boolean(store?.skipTenantFilter);
  },

  /**
   * Runs an operation with tenant filter bypassed.
   *
   * @param {Function} callback
   * @returns {*}
   */
  runWithSkip(callback) {
    const current = asyncLocalStorage.getStore() || {};
    return asyncLocalStorage.run({ ...current, skipTenantFilter: true }, callback);
  },
};

/**
 * Returns the base model directly for the shared-collection architecture.
 * Maintained for transparent backward compatibility across existing model definitions.
 */
export const createDynamicModelProxy = (modelName, baseModel) => {
  return baseModel;
};

export default tenantContext;
