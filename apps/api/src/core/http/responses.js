/**
 * 200 with the success envelope `{ data, meta? }`.
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {Record<string, unknown>} [meta]
 */
export function ok(res, data, meta) {
  return res.status(200).json(meta === undefined ? { data } : { data, meta });
}

/**
 * 201 with the success envelope `{ data }`.
 * @param {import('express').Response} res
 * @param {unknown} data
 */
export function created(res, data) {
  return res.status(201).json({ data });
}
