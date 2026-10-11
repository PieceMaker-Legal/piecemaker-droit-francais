import { PRODUCT_NAME } from '@/shared/constants';

export default function PieceMakerLogo() {
  return (
    <div className="h-16 w-16">
      <img src="/logo-sources/logo-black.png" alt={PRODUCT_NAME} className="h-full w-full dark:hidden" />
      <img src="/logo-sources/logo-white.png" alt={PRODUCT_NAME} className="hidden h-full w-full dark:block" />
    </div>
  );
}
