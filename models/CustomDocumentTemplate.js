import mongoose from 'mongoose';

/**
 * @model CustomDocumentTemplate
 *
 * Stores admin-created CUSTOM template configurations.
 * Default templates live in the frontend codebase (src/pages/certificates/templates/).
 * Only customized/cloned templates need server-side persistence for cross-device sharing.
 *
 * IMPORTANT: This model stores configuration data only — NOT generated HTML/PDF/images.
 * The final document is still rendered at runtime using: templateConfig + recipient data.
 */
const CustomDocumentTemplateSchema = new mongoose.Schema(
  {
    /** Display name for this custom template */
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * The ID of the built-in template this was cloned/derived from.
     * Built-in templates are protected and cannot be overwritten.
     * Example: "student-id-classic", "certificate-modern-v1"
     */
    baseTemplateId: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Category determines which document type this template produces.
     */
    category: {
      type: String,
      required: true,
      enum: ['student-id-card', 'teacher-id-card', 'staff-id-card', 'certificate'],
    },

    /**
     * Visual and behavioral configuration overrides.
     * These are applied on top of the base template at render time.
     * The base template's render() function checks for these overrides.
     */
    configuration: {
      primaryColor: { type: String, default: '#4f46e5' },
      secondaryColor: { type: String, default: '#818cf8' },
      accentColor: { type: String, default: '#e0e7ff' },
      fontFamily: { type: String, default: 'Inter, sans-serif' },
      layout: { type: String, enum: ['vertical', 'horizontal', 'square'], default: 'vertical' },
      showQRCode: { type: Boolean, default: true },
      showPhoto: { type: Boolean, default: true },
      showSignature: { type: Boolean, default: true },
      showSchoolLogo: { type: Boolean, default: true },
      showBloodGroup: { type: Boolean, default: true },
      /** Custom fields to show or hide on the document */
      visibleFields: { type: [String], default: [] },
      /** Custom footer text override */
      footerText: { type: String, default: '' },
      /** Custom header text override */
      headerText: { type: String, default: '' },
    },

    /** The user who created this custom template */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /** Soft delete — deactivated templates are hidden but preserved */
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for efficient template listing by category and creator
CustomDocumentTemplateSchema.index({ category: 1, isActive: 1 });
CustomDocumentTemplateSchema.index({ createdBy: 1, isActive: 1 });

export default mongoose.model('CustomDocumentTemplate', CustomDocumentTemplateSchema);
