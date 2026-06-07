import { v2 as cloudinary } from 'cloudinary';

export const configureCloudinary = () => {
  if (!process.env.CLOUDINARY_URL) {
    throw new Error('CLOUDINARY_URL is not configured');
  }

  cloudinary.config(true);
  cloudinary.config({ secure: true });
  return cloudinary;
};

export default cloudinary;
