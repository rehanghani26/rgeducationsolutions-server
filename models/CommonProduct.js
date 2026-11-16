import mongoose from "mongoose";

const CommonProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommonCategory",
    },
    categoryName: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    unit: {
      type: String,
      default: "piece", // piece, box, set, kg, etc.
    },
    basePrice: {
      type: Number,
      default: 0,
    },
    suggestedRetailPrice: {
      type: Number,
      default: 0,
    },
    images: [
      {
        url: String,
        isPrimary: Boolean,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    vendor: {
      name: String,
      contact: String,
    },
  },
  {
    timestamps: true,
    collection: "common_products",
  }
);

export default mongoose.model("CommonProduct", CommonProductSchema);
