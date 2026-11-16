import tenantContext from "./tenantContext.js";

/**
 * @file tenantPlugin.js
 * @description Global Mongoose plugin for single-database, shared-collection multi-tenancy.
 * Injects mandatory schoolId field and automatically enforces tenant query/mutation scoping.
 */

export const tenantPlugin = (schema, options = {}) => {
  // Check if collection is platform or global master
  const col = (schema.options?.collection || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const skippedCollections = [
    "schools",
    "rgesadmins",
    "rgesadmin",
    "platformadmins",
    "commonproducts",
    "commoncategories",
    "commoncategorys",
    "subscriptions",
    "platformsettings",
    "units",
    "productbrands"
  ];

  if (skippedCollections.includes(col) || options.skipTenantPlugin) {
    return;
  }

  // 1. Add mandatory schoolId field to schema if not already present
  if (!schema.path("schoolId")) {
    schema.add({
      schoolId: {
        type: String,
        required: [
          function () {
            // Only require schoolId on top-level root documents, NEVER on nested subdocuments
            return !this.$isSubdocument && (!this.ownerDocument || this.ownerDocument() === this);
          },
          "schoolId is mandatory for school data separation",
        ],
        index: true,
        trim: true,
        uppercase: true,
      },
    });
  }

  // 2. Pre-validate hook: auto-populate schoolId from context if creating new document
  schema.pre("validate", function (next) {
    // If this is a nested subdocument inside an array/embedded doc, skip tenant validation
    if (this.$isSubdocument || (typeof this.ownerDocument === 'function' && this.ownerDocument() !== this)) {
      return next();
    }

    const currentSchoolId = tenantContext.getSchoolId();
    if (!this.schoolId && currentSchoolId) {
      this.schoolId = currentSchoolId;
    }

    if (
      currentSchoolId &&
      this.schoolId &&
      this.schoolId !== currentSchoolId &&
      !tenantContext.isSkipped()
    ) {
      return next(
        new Error(
          `TenantViolation: Cannot assign document to schoolId '${this.schoolId}' when active tenant is '${currentSchoolId}'`
        )
      );
    }
    next();
  });

  // Helper to apply tenant filter to query
  const applyTenantFilter = function (next) {
    if (this.getOptions()?.skipTenantFilter || tenantContext.isSkipped()) {
      return next ? next() : undefined;
    }

    const currentSchoolId = tenantContext.getSchoolId();
    if (!currentSchoolId) {
      // If running outside a tenant request (e.g. system background cron with explicit query), proceed
      return next ? next() : undefined;
    }

    const filter = this.getFilter() || {};

    // If query already has a schoolId specified, verify it matches the active tenant
    if (filter.schoolId && filter.schoolId !== currentSchoolId) {
      // Overwrite with authenticated tenant to prevent cross-tenant parameter tampering
      this.where({ schoolId: currentSchoolId });
    } else if (!filter.schoolId) {
      this.where({ schoolId: currentSchoolId });
    }

    if (next) next();
  };

  // 3. Query Middleware Hooks
  schema.pre("find", applyTenantFilter);
  schema.pre("findOne", applyTenantFilter);
  schema.pre("findOneAndUpdate", applyTenantFilter);
  schema.pre("findOneAndReplace", applyTenantFilter);
  schema.pre("findOneAndDelete", applyTenantFilter);
  schema.pre("countDocuments", applyTenantFilter);
  schema.pre("count", applyTenantFilter);
  schema.pre("updateOne", applyTenantFilter);
  schema.pre("updateMany", applyTenantFilter);
  schema.pre("deleteOne", applyTenantFilter);
  schema.pre("deleteMany", applyTenantFilter);

  // 4. Aggregation Middleware Hook: Prepend $match: { schoolId }
  schema.pre("aggregate", function (next) {
    if (this.options?.skipTenantFilter || tenantContext.isSkipped()) {
      return next ? next() : undefined;
    }

    const currentSchoolId = tenantContext.getSchoolId();
    if (currentSchoolId) {
      const pipeline = this.pipeline();
      const firstStage = pipeline[0];
      if (!firstStage || !firstStage.$match || !firstStage.$match.schoolId) {
        pipeline.unshift({ $match: { schoolId: currentSchoolId } });
      }
    }
    if (next) next();
  });
};

export default tenantPlugin;
