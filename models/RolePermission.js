import mongoose from 'mongoose';
import tenantPlugin from '../utils/tenantPlugin.js';
import { createDynamicModelProxy } from '../utils/tenantContext.js';

/**
 * @file RolePermission.js
 * @description Tenant-scoped role and access control definition.
 * Governs Tier 1 (Sidebar/Modules), Tier 2 (Buttons/Actions), and Tier 3 (Views/Workflows).
 */

const RolePermissionSchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      required: [true, 'schoolId is mandatory for tenant role permissions separation'],
      index: true,
      uppercase: true,
      trim: true,
    },
    role: {
      type: String,
      required: [true, 'Role identifier is required'],
      trim: true,
      lowercase: true,
    },
    // Tier 1: Modules visible in sidebar and accessible via navigation
    modules: [{ type: String, trim: true }],

    // Tier 2: Granular action capabilities per module
    actions: {
      type: Map,
      of: [String],
      default: {},
    },

    // Tier 2: Specific Button Identifier Whitelist
    buttons: [{ type: String, trim: true }],

    // Tier 3: View & Data Scoping Rules
    viewScope: {
      type: String,
      enum: ['school_wide', 'assigned_only', 'self_only', 'none'],
      default: 'self_only',
    },

    // Module-specific workflow flags
    workflowSettings: {
      canApplyLeaveSelf: { type: Boolean, default: true },
      canApplyLeaveOnBehalf: { type: Boolean, default: false },
      canApproveLeaves: { type: Boolean, default: false },
      leaveApprovalScope: {
        type: String,
        enum: ['none', 'class_students', 'all_students', 'staff_and_teachers', 'all'],
        default: 'none',
      },
      canViewBudget: { type: Boolean, default: false },
      canReviseBudget: { type: Boolean, default: false },
      canManageUsers: { type: Boolean, default: false },
    },

    isCustomized: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

RolePermissionSchema.index({ schoolId: 1, role: 1 }, { unique: true });
RolePermissionSchema.plugin(tenantPlugin);

const RolePermission =
  mongoose.models.RolePermission ||
  mongoose.model('RolePermission', RolePermissionSchema);

export default createDynamicModelProxy('RolePermission', RolePermission);
