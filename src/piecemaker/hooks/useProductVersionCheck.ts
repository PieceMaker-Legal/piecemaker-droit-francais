import { PRODUCT_REPOSITORY } from '@/shared/constants';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';

const [configuredReleaseOwner, configuredReleaseRepository] = PRODUCT_REPOSITORY.split('/', 2);
const releaseOwner = configuredReleaseOwner || 'siteboon';
const releaseRepository = configuredReleaseRepository || 'claudecodeui';

export function useProductVersionCheck() {
  return useVersionCheck(releaseOwner, releaseRepository);
}
