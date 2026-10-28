import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const databaseName = process.env.TEST_DATABASE_NAME
if (!databaseName || !/(?:_test|_qa)$/i.test(databaseName))
  throw new Error('Use um banco descartável terminado em _test ou _qa.')
const url = new URL(process.env.DATABASE_URL)
if (url.pathname.slice(1) === databaseName)
  throw new Error('O banco QA deve ser diferente do banco da aplicação.')
const isolatedName = `fifo_${randomUUID().replaceAll('-', '')}_qa`
const adminConnection = new pg.Client({ connectionString: url.toString() })
await adminConnection.connect()
await adminConnection.query(`CREATE DATABASE "${isolatedName}"`)
url.pathname = `/${isolatedName}`
process.env.DATABASE_URL = url.toString()
process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET = 'fifo-price-alert-isolated-validation-secret'
process.env.SEED_USERS = 'true'
for (const role of ['ADMIN', 'OPERATOR']) {
  process.env[`SEED_${role}_NAME`] = `${role} FIFO QA`
  process.env[`SEED_${role}_USERNAME`] = `${role.toLowerCase()}-fifo-qa`
  process.env[`SEED_${role}_EMAIL`] = `${role.toLowerCase()}-fifo-qa@example.test`
  process.env[`SEED_${role}_PASSWORD`] = 'FifoValidation2026!'
}

test('alerta de preço acompanha lotes FIFO sem permitir venda abaixo do custo', async () => {
  const { app } = await import('../src/app.js')
  const { database } = await import('../src/database.js')
  const { migrate } = await import('../src/schema.js')
  await migrate(database)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  let cookie = ''
  async function call(path, body) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0]
    return { status: response.status, data: await response.json() }
  }
  try {
    assert.equal(
      (await call('/auth/login', { username: 'admin-fifo-qa', password: 'FifoValidation2026!' }))
        .status,
      200,
    )
    const category = await call('/categories', { name: 'FIFO alerta QA', description: '' })
    const supplier = await call('/suppliers', {
      name: 'Fornecedor FIFO alerta QA',
      contact: '',
      email: '',
    })
    const product = await call('/products', {
      code: 'FIFO-ALERTA-QA',
      name: 'Produto FIFO alerta QA',
      categoryId: category.data.id,
      unit: 'Unidade',
      minimum: 0,
      price: 30,
      initialStock: 0,
    })
    assert.equal(product.status, 201)
    const buy = (cost, sale, date) =>
      call('/movements', {
        productId: product.data.id,
        type: 'Entrada',
        quantity: 2,
        supplierId: supplier.data.id,
        unitCost: cost,
        unitSalePrice: sale,
        occurredAt: date,
      })
    const currentProduct = async () =>
      (await call('/products/search?search=FIFO-ALERTA-QA')).data.products[0]
    assert.equal((await buy(20, 30, '2026-10-25')).status, 201)
    assert.equal((await buy(5, 10, '2026-10-26')).status, 201)
    let item = await currentProduct()
    assert.equal(Number(item.nextFifoCost), 20)
    assert.equal(Number(item.price), 10)
    assert.equal(Number(item.unitsBelowSaleCost), 2)
    assert.equal(Number(item.highestRemainingCost), 20)
    const blocked = await call('/movements', {
      productId: product.data.id,
      type: 'Saída',
      quantity: 1,
      unitSalePrice: 10,
      occurredAt: '2026-10-27',
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.error.code, 'SALE_BELOW_COST')
    assert.equal((await currentProduct()).stock, 4)
    assert.equal(
      (
        await call('/movements', {
          productId: product.data.id,
          type: 'Saída',
          quantity: 2,
          unitSalePrice: 20,
          occurredAt: '2026-10-27',
        })
      ).status,
      201,
    )
    item = await currentProduct()
    assert.equal(Number(item.nextFifoCost), 5)
    assert.equal(Number(item.unitsBelowSaleCost), 0)
    assert.equal(Number(item.highestRemainingCost), 5)
    // Um lote futuro mais caro também precisa aparecer, mesmo com a próxima unidade segura.
    assert.equal((await buy(30, 35, '2026-10-28')).status, 201)
    await database.query('UPDATE products SET price=10 WHERE id=$1', [product.data.id])
    item = await currentProduct()
    assert.equal(Number(item.nextFifoCost), 5)
    assert.equal(Number(item.unitsBelowSaleCost), 2)
    assert.equal(Number(item.highestRemainingCost), 30)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await database.end()
    await adminConnection.query(`DROP DATABASE "${isolatedName}"`)
    await adminConnection.end()
  }
})
