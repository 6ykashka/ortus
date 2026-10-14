// ortus-x-permissions-in-catalog: ключ x-permissions есть в каталоге api/permissions.yaml.
import { dictionaries } from './_dictionaries.js';

export default function inCatalog(input) {
  const { permissions } = dictionaries();
  if (typeof input !== 'string' || !permissions.includes(input)) {
    return [{ message: `Права «${input}» нет в каталоге api/permissions.yaml.` }];
  }
  return [];
}
