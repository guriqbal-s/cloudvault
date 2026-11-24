// Request validation with Zod schemas.
//
//   router.post('/folders', validate({ body: createFolderSchema }), controller.create)
//
// Parsed (and coerced / stripped) values replace req.body, req.query and req.params, so
// controllers only ever see validated data.

import ApiError from '../utils/ApiError.js';

const SOURCES = ['params', 'query', 'body'];

export default function validate(schemas) {
  return (req, _res, next) => {
    const issues = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source] ?? {});
      if (result.success) {
        req[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ in: source, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length) return next(ApiError.validation('Validation failed', issues));
    return next();
  };
}
