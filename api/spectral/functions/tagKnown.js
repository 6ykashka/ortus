// ortus-tag-known: тег операции объявлен в корневом списке tags (по тегу — файл paths/<tag>.yaml).
export default function tagKnown(input, options, context) {
  const tags = (context?.document?.data?.tags ?? []).map((t) => t?.name);
  if (typeof input === 'string' && !tags.includes(input)) {
    return [{ message: `Тег «${input}» не объявлен в tags.` }];
  }
  return [];
}
