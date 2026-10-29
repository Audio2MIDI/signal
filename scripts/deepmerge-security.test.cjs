const { test } = require("node:test")
const assert = require("node:assert/strict")
const merge = require("deepmerge")
const path = require("node:path")
const root = path.resolve(__dirname, "..")

test("Jest and type-checker resolve the reviewed local fork", () => {
  const entry = require.resolve("deepmerge")
  assert.equal(entry, path.join(root, "vendor/deepmerge/index.cjs"))
  for (const consumer of ["jest-config", "fork-ts-checker-webpack-plugin"]) {
    const { createRequire } = require("node:module")
    assert.equal(
      createRequire(require.resolve(consumer)).resolve("deepmerge"),
      entry,
    )
  }
})

for (const [name, target] of [
  ["null prototype", Object.create(null)],
  ["own proto key", JSON.parse('{"__proto__":{"admin":true}}')],
  ["nested null", { session: null }],
  ["nested undefined", { session: undefined }],
  ["nested primitive", { session: 1 }],
]) {
  test(`prototype poisoning is blocked for ${name}`, () => {
    const payload = JSON.parse(
      '{"__proto__":{"admin":true},"session":{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"ok":1}}',
    )
    const result = merge(target, payload)
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
    assert.equal(Object.getPrototypeOf(result.session), Object.prototype)
    assert.equal(result.admin, undefined)
    assert.equal(result.session.admin, undefined)
    assert.equal(Object.hasOwn(result, "__proto__"), false)
    assert.equal(Object.hasOwn(result.session, "constructor"), false)
    assert.equal(result.session.ok, 1)
    assert.equal({}.admin, undefined)
  })
}

test("dangerous getters are not evaluated on target or source", () => {
  const dangerous = {}
  for (const key of ["__proto__", "constructor", "prototype"]) {
    Object.defineProperty(dangerous, key, {
      enumerable: true,
      get() {
        throw Error("getter called")
      },
    })
  }
  assert.deepEqual(merge(dangerous, {}), {})
  assert.deepEqual(merge({}, dangerous), {})
})

test("objects, arrays, symbols, dates and immutability retain upstream semantics", () => {
  const key = Symbol("key"),
    date = new Date(0)
  const a = { nested: { a: 1 }, list: [{ a: 1 }], [key]: "a", date }
  const b = { nested: { b: 2 }, list: [{ b: 2 }], [key]: "b" }
  const result = merge(a, b)
  assert.deepEqual(result.nested, { a: 1, b: 2 })
  assert.deepEqual(result.list, [{ a: 1 }, { b: 2 }])
  assert.notEqual(result.list[0], a.list[0])
  assert.deepEqual(a.nested, { a: 1 })
  assert.equal(result[key], "b")
  assert.equal(result.date, date)
  assert.equal(merge({}, a, { clone: false }).nested, a.nested)
})

test("all, custom merge, custom array merge and mergeable predicates retain API", () => {
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 })
  assert.throws(() => merge.all({}), /array/)
  assert.deepEqual(merge([1], [2], { arrayMerge: (_, source) => source }), [2])
  assert.deepEqual(
    merge(
      { a: { x: 1 } },
      { a: { x: 2 } },
      { customMerge: (key) => (key === "a" ? () => ({ x: 3 }) : undefined) },
    ),
    { a: { x: 3 } },
  )
  const special = { x: 1 }
  assert.equal(
    merge(
      {},
      { a: special },
      { isMergeableObject: (value) => value !== special },
    ).a,
    special,
  )
})
