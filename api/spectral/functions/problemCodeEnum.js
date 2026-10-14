// ortus-problem-code-enum: Problem.code — перечисление, равное реестру api/errors.yaml (тот же порядок).
import { dictionaries } from './_dictionaries.js';

export default function problemCodeEnum(input) {
  const { problemCodes } = dictionaries();
  const actual = Array.isArray(input?.enum) ? input.enum : null;
  if (!actual) return [{ message: 'Problem.code должен быть enum кодов api/errors.yaml.' }];
  if (JSON.stringify(actual) !== JSON.stringify(problemCodes)) {
    const extra = actual.filter((c) => !problemCodes.includes(c));
    const missing = problemCodes.filter((c) => !actual.includes(c));
    return [
      {
        message:
          `enum Problem.code не равен api/errors.yaml` +
          (extra.length ? `; лишние: ${extra.join(', ')}` : '') +
          (missing.length ? `; нет: ${missing.join(', ')}` : '') +
          (!extra.length && !missing.length ? '; другой порядок' : ''),
      },
    ];
  }
  return [];
}
