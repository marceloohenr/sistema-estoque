import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const databaseName = process.env.TEST_DATABASE_NAME
if (!databaseName || !/(?:_test|_qa)$/i.test(databaseName)) {
  throw new Error('Defina TEST_DATABASE_NAME com o nome de um banco descartável terminado em _test ou _qa.')
}

const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
if (databaseUrl.pathname.slice(1) === databaseName) {
  throw new Error('O banco de testes não pode ser o mesmo banco configurado para a aplicação.')
}
databaseUrl.pathname = `/${databaseName}`
process.env.DATABASE_URL = databaseUrl.toString()
process.env.SESSION_SECRET = 'integration-tests-only-session-secret-2026'
process.env.APP_ORIGIN = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.SEED_USERS = 'true'

const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const initialPassword = 'Estoque123'
const updatedPassword = 'EstoqueSeguro2026!'
process.env.SEED_ADMIN_NAME = 'Administração QA'
process.env.SEED_ADMIN_USERNAME = `admin-${suffix}`
process.env.SEED_ADMIN_EMAIL = `admin-${suffix}@example.test`
process.env.SEED_ADMIN_PASSWORD = initialPassword
process.env.SEED_OPERATOR_NAME = 'Operador QA'
process.env.SEED_OPERATOR_USERNAME = `operador-${suffix}`
process.env.SEED_OPERATOR_EMAIL = `operador-${suffix}@example.test`
process.env.SEED_OPERATOR_PASSWORD = initialPassword
process.env.UPLOADS_DIR = await mkdtemp(join(tmpdir(), 'estoque-qa-'))

const { app } = await import('../src/app.js')
const { database } = await import('../src/database.js')
const { migrate } = await import('../src/schema.js')
await migrate(database)

const server = app.listen(0, '127.0.0.1')
await new Promise((resolve, reject) => {
  server.once('listening', resolve)
  server.once('error', reject)
})
const baseUrl = `http://127.0.0.1:${server.address().port}/api`

async function call(path, { method = 'GET', body, cookie = '', origin } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (origin) headers.origin = origin
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = response.headers.get('set-cookie')
  const nextCookie = setCookie ? setCookie.split(';')[0] : cookie
  const payload = response.status === 204 ? null : await response.json()
  return { status: response.status, payload, cookie: nextCookie, setCookie }
}

async function upload(path, file, contentType, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': contentType },
    body: file,
  })
  return { status: response.status, payload: await response.json() }
}

async function login(username, password) {
  const result = await call('/auth/login', { method: 'POST', origin: 'http://localhost:5173', body: { username, password } })
  assert.equal(result.status, 200)
  return { user: result.payload.user, cookie: result.cookie }
}

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await database.end()
  await rm(process.env.UPLOADS_DIR, { recursive: true, force: true })
})

test('fluxos de autenticação, permissões, estoque e auditoria persistem no banco', async () => {
  const wrongPassword = await call('/auth/login', { method: 'POST', body: { username: process.env.SEED_ADMIN_USERNAME, password: 'senha-incorreta' } })
  assert.equal(wrongPassword.status, 401)

  const blockedOrigin = await call('/auth/login', { method: 'POST', origin: 'https://origem-invalida.example', body: { username: process.env.SEED_ADMIN_USERNAME, password: initialPassword } })
  assert.equal(blockedOrigin.status, 403)

  const admin = await login(process.env.SEED_ADMIN_USERNAME.toUpperCase(), initialPassword)
  const staleAdminCookie = admin.cookie
  assert.equal(admin.user.roleKey, 'admin')
  assert.equal(admin.user.username, process.env.SEED_ADMIN_USERNAME)
  assert.equal(Object.hasOwn(admin.user, 'mustChangePassword'), false)
  const firstLoginProducts = await call('/products', { cookie: admin.cookie })
  assert.equal(firstLoginProducts.status, 200)
  assert.deepEqual(firstLoginProducts.payload, [])

  const shortPassword = await call('/auth/change-password', {
    method: 'POST', cookie: admin.cookie,
    body: { currentPassword: initialPassword, newPassword: 'curta' },
  })
  assert.equal(shortPassword.status, 400)

  const passwordUpdate = await call('/auth/change-password', {
    method: 'POST', cookie: admin.cookie,
    body: { currentPassword: initialPassword, newPassword: updatedPassword },
  })
  assert.equal(passwordUpdate.status, 200)
  assert.equal(Object.hasOwn(passwordUpdate.payload.user, 'mustChangePassword'), false)
  assert.match(passwordUpdate.setCookie ?? '', /estoque\.sid=/)
  assert.equal((await call('/auth/me', { cookie: staleAdminCookie })).status, 401)
  admin.cookie = passwordUpdate.cookie
  assert.equal((await call('/auth/me', { cookie: admin.cookie })).status, 200)

  const category = await call('/categories', { method: 'POST', cookie: admin.cookie, body: { name: `Categoria ${suffix}`, description: 'Categoria criada durante teste automatizado.' } })
  assert.equal(category.status, 201)
  const changedCategory = await call(`/categories/${category.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: `Categoria editada ${suffix}`, description: 'Descrição atualizada.' } })
  assert.equal(changedCategory.status, 200)
  assert.equal(changedCategory.payload.description, 'Descrição atualizada.')
  const invalidSupplier = await call('/suppliers', { method: 'POST', cookie: admin.cookie, body: { name: `Fornecedor inválido ${suffix}`, email: 'endereco-invalido' } })
  assert.equal(invalidSupplier.status, 400)
  assert.equal(invalidSupplier.payload.error.code, 'INVALID_EMAIL')
  const supplier = await call('/suppliers', { method: 'POST', cookie: admin.cookie, body: { name: `Fornecedor ${suffix}`, contact: '(85) 3000-0000', email: `fornecedor-${suffix}@example.test` } })
  assert.equal(supplier.status, 201)
  const reportBaseline = await call('/reports?period=7d', { cookie: admin.cookie })
  assert.equal(reportBaseline.status, 200)
  const changedSupplier = await call(`/suppliers/${supplier.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { name: supplier.payload.name, contact: '(85) 3000-1111', email: supplier.payload.email } })
  assert.equal(changedSupplier.status, 200)
  assert.equal(changedSupplier.payload.contact, '(85) 3000-1111')

  const product = await call('/products', {
    method: 'POST', cookie: admin.cookie,
    body: { code: `QA-${suffix}`, name: `Produto QA ${suffix}`, categoryId: category.payload.id, supplierId: supplier.payload.id, unit: 'Unidade', initialStock: 10, minimum: 3, entryCost: 10, price: 20 },
  })
  assert.equal(product.status, 201)
  assert.equal(product.payload.stock, 10)
  const initialEntries = await call(`/products/${product.payload.id}/entries`, { cookie: admin.cookie })
  assert.equal(initialEntries.status, 200)
  assert.equal(initialEntries.payload.length, 1)
  assert.equal(initialEntries.payload[0].supplier, supplier.payload.name)
  assert.equal(Number(initialEntries.payload[0].unitCost), 10)
  assert.equal(Number(initialEntries.payload[0].unitSalePrice), 20)
  assert.equal(Number(initialEntries.payload[0].totalCost), 100)

  const customReport = await call(`/reports?period=custom&from=2026-01-01&to=2026-12-31&productId=${product.payload.id}`, { cookie: admin.cookie })
  assert.equal(customReport.status, 200)
  assert.equal(customReport.payload.filters.from, '2026-01-01')
  assert.equal(customReport.payload.filters.to, '2026-12-31')
  assert.equal(customReport.payload.summary.entries, 1)
  const invalidCustomPeriod = await call('/reports?period=custom&from=2026-12-31&to=2026-01-01', { cookie: admin.cookie })
  assert.equal(invalidCustomPeriod.status, 400)
  const customHistory = await call(`/reports/product/${product.payload.id}/movements?period=custom&from=2026-01-01&to=2026-12-31`, { cookie: admin.cookie })
  assert.equal(customHistory.status, 200)
  assert.equal(customHistory.payload.total, 1)

  await migrate(database)
  const entriesAfterRestartMigration = await call(`/products/${product.payload.id}/entries`, { cookie: admin.cookie })
  assert.equal(entriesAfterRestartMigration.payload.length, 1)
  assert.equal(entriesAfterRestartMigration.payload[0].quantityRemaining, 10)
  const unknownCostProduct = await call('/products', { method: 'POST', cookie: admin.cookie, body: { code: `QA-CUSTO-${suffix}`, name: `Saldo sem custo ${suffix}`, categoryId: category.payload.id, unit: 'Unidade', price: 15, initialStock: 0 } })
  assert.equal(unknownCostProduct.status, 201)
  const registeredProductsReport = await call(`/reports?period=7d&productId=${unknownCostProduct.payload.id}`, { cookie: admin.cookie })
  assert.equal(registeredProductsReport.payload.productMargins.length, 1)
  assert.equal(registeredProductsReport.payload.productMargins[0].productId, unknownCostProduct.payload.id)
  assert.equal(registeredProductsReport.payload.productMargins[0].purchaseCount, 0)
  assert.equal(registeredProductsReport.payload.productMargins[0].saleCount, 0)
  assert.equal(registeredProductsReport.payload.productMargins[0].knownUnits, 0)
  const adjustmentWithoutCost = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: unknownCostProduct.payload.id, type: 'Ajuste', adjustment: 4, reason: 'Contagem inicial' } })
  assert.equal(adjustmentWithoutCost.status, 400)
  assert.equal(adjustmentWithoutCost.payload.error.code, 'ADJUSTMENT_COST_REQUIRED')
  const adjustmentWithCost = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: unknownCostProduct.payload.id, type: 'Ajuste', adjustment: 4, unitCost: 8, reason: 'Contagem inicial com custo conhecido' } })
  assert.equal(adjustmentWithCost.status, 201)
  const adjustedProduct = (await call('/products', { cookie: admin.cookie })).payload.find((item) => item.id === unknownCostProduct.payload.id)
  assert.equal(adjustedProduct.costPending, false)
  await database.query('UPDATE inventory_lots SET unit_cost=NULL WHERE movement_id=$1', [adjustmentWithCost.payload.id])
  const pendingCostReport = await call(`/reports?period=7d&productId=${unknownCostProduct.payload.id}`, { cookie: admin.cookie })
  const pendingCostMargin = pendingCostReport.payload.productMargins.find((item) => item.productId === unknownCostProduct.payload.id)
  assert.equal(pendingCostMargin.knownUnits, 0)
  assert.equal(pendingCostMargin.pendingUnits, 4)
  assert.equal(Number(pendingCostMargin.forecastRevenue), 0)
  assert.equal(Number(pendingCostMargin.forecastMargin), 0)
  assert.equal(pendingCostReport.payload.summary.costPending, true)
  const blockedUnknownCostSale = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: unknownCostProduct.payload.id, type: 'Saída', quantity: 1, unitSalePrice: 15 } })
  assert.equal(blockedUnknownCostSale.status, 409)
  assert.equal(blockedUnknownCostSale.payload.error.code, 'COST_BASELINE_REQUIRED')
  const removeUncostedStock = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: unknownCostProduct.payload.id, type: 'Ajuste', adjustment: -4, reason: 'Retirada de saldo sem custo conhecido' } })
  assert.equal(removeUncostedStock.status, 201)
  const emptyProduct = (await call('/products', { cookie: admin.cookie })).payload.find((item) => item.id === unknownCostProduct.payload.id)
  assert.equal(emptyProduct.stock, 0)
  assert.equal(emptyProduct.costPending, false)
  assert.equal((await call(`/products/${unknownCostProduct.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 204)
  const supplierEntries = await call(`/suppliers/${supplier.payload.id}/entries`, { cookie: admin.cookie })
  assert.equal(supplierEntries.status, 200)
  const supplierProductEntry = supplierEntries.payload.find((entry) => entry.productId === product.payload.id)
  assert.equal(supplierProductEntry.productName, product.payload.name)
  assert.equal(Number(supplierProductEntry.unitCost), 10)
  const changedProduct = await call(`/products/${product.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { code: product.payload.code, name: `Produto editado ${suffix}`, categoryId: category.payload.id, supplierId: supplier.payload.id, unit: 'Unidade', minimum: 4, price: 12 } })
  assert.equal(changedProduct.status, 200)
  assert.equal(changedProduct.payload.stock, 10)
  assert.equal(changedProduct.payload.minimum, 4)

  const alternateSupplier = await call('/suppliers', { method: 'POST', cookie: admin.cookie, body: { name: `Outro fornecedor ${suffix}`, contact: '(85) 99999-0000', email: `outro-${suffix}@example.test` } })
  assert.equal(alternateSupplier.status, 201)
  const quote = await call(`/suppliers/${alternateSupplier.payload.id}/quotes`, {
    method: 'POST', cookie: admin.cookie,
    body: { productId: product.payload.id, unitPrice: 3.75, quotedAt: '2026-10-20', note: 'Entrega em cinco dias.' },
  })
  assert.equal(quote.status, 201)
  assert.equal(quote.payload.unitPrice, 3.75)
  const newerQuote = await call(`/suppliers/${alternateSupplier.payload.id}/quotes`, {
    method: 'POST', cookie: admin.cookie,
    body: { productId: product.payload.id, unitPrice: 4.15, quotedAt: '2026-10-22', note: 'Preço atualizado.' },
  })
  assert.equal(newerQuote.status, 201)
  const quoteHistory = await call(`/suppliers/${alternateSupplier.payload.id}/quotes`, { cookie: admin.cookie })
  assert.equal(quoteHistory.status, 200)
  assert.equal(quoteHistory.payload.length, 2)
  assert.equal(quoteHistory.payload[0].unitPrice, 4.15)
  assert.equal(quoteHistory.payload[0].productId, product.payload.id)
  const supplierPricesSaved = await call(`/products/${product.payload.id}`, {
    method: 'PATCH', cookie: admin.cookie,
    body: {
      code: product.payload.code, name: changedProduct.payload.name, categoryId: category.payload.id,
      supplierId: supplier.payload.id, unit: 'Unidade', minimum: 4, price: 12,
      supplierOffers: [
        { supplierId: supplier.payload.id, unitPrice: 8.5, quotedAt: '2026-10-21' },
        { supplierId: alternateSupplier.payload.id, unitPrice: 2.25, quotedAt: '2026-10-23' },
      ],
    },
  })
  assert.equal(supplierPricesSaved.status, 200)
  const linkedSuppliers = await call('/suppliers', { cookie: admin.cookie })
  assert.equal(linkedSuppliers.payload.find((item) => item.id === alternateSupplier.payload.id).products, 1)
  const alternateProducts = await call(`/suppliers/${alternateSupplier.payload.id}/products`, { cookie: admin.cookie })
  assert.equal(alternateProducts.status, 200)
  assert.ok(alternateProducts.payload.some((item) => item.id === product.payload.id))
  const linkedAgain = await call(`/suppliers/${alternateSupplier.payload.id}/products`, { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id } })
  assert.equal(linkedAgain.status, 201)
  const unlinked = await call(`/suppliers/${alternateSupplier.payload.id}/products/${product.payload.id}`, { method: 'DELETE', cookie: admin.cookie })
  assert.equal(unlinked.status, 204)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/products`, { cookie: admin.cookie })).payload.some((item) => item.id === product.payload.id), false)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/quotes`, { cookie: admin.cookie })).payload.length, 2)
  await migrate(database)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/products`, { cookie: admin.cookie })).payload.some((item) => item.id === product.payload.id), false)
  const relinked = await call(`/suppliers/${alternateSupplier.payload.id}/products`, { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id } })
  assert.equal(relinked.status, 201)
  const deactivatedSupplier = await call(`/suppliers/${alternateSupplier.payload.id}/status`, { method: 'PATCH', cookie: admin.cookie, body: { active: false } })
  assert.equal(deactivatedSupplier.status, 200)
  assert.equal(deactivatedSupplier.payload.status, 'Inativo')
  const activeSuppliers = await call('/suppliers', { cookie: admin.cookie })
  assert.ok(!activeSuppliers.payload.some((item) => item.id === alternateSupplier.payload.id))
  const allSuppliers = await call('/suppliers?status=all', { cookie: admin.cookie })
  assert.equal(allSuppliers.payload.find((item) => item.id === alternateSupplier.payload.id).status, 'Inativo')
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/products`, { cookie: admin.cookie })).status, 200)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/status`, { method: 'PATCH', cookie: admin.cookie, body: { active: true } })).payload.status, 'Ativo')
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  const invalidImage = await upload(`/products/${product.payload.id}/image`, Buffer.from('not an image'), 'image/png', admin.cookie)
  assert.equal(invalidImage.status, 415)
  const oversizedImage = await upload(`/products/${product.payload.id}/image`, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', admin.cookie)
  assert.equal(oversizedImage.status, 413)
  const productImage = await upload(`/products/${product.payload.id}/image`, png, 'image/png', admin.cookie)
  assert.equal(productImage.status, 200)
  assert.match(productImage.payload.imageUrl, /^\/uploads\/[0-9a-f-]+\.png$/)
  const supplierImage = await upload(`/suppliers/${alternateSupplier.payload.id}/image`, png, 'image/png', admin.cookie)
  assert.equal(supplierImage.status, 200)
  const imageResponse = await fetch(`${baseUrl.replace('/api', '')}${productImage.payload.imageUrl}`, { headers: { cookie: admin.cookie } })
  assert.equal(imageResponse.status, 200)
  assert.equal(imageResponse.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png)
  const unchangedStock = await call('/products', { cookie: admin.cookie })
  assert.equal(unchangedStock.payload.find((item) => item.id === product.payload.id).stock, 10)
  assert.equal(unchangedStock.payload.find((item) => item.id === product.payload.id).price, 12)

  const duplicate = await call('/products', {
    method: 'POST', cookie: admin.cookie,
    body: { code: `QA-${suffix}`, name: 'Duplicado', categoryId: category.payload.id, unit: 'Unidade', minimum: 0, price: 1, initialStock: 0 },
  })
  assert.equal(duplicate.status, 409)

  const outgoing = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id, type: 'Saída', quantity: 2, reason: 'Teste de retirada' } })
  assert.equal(outgoing.status, 201)
  assert.equal(outgoing.payload.quantity, -2)
  const insufficient = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id, type: 'Saída', quantity: 99 } })
  assert.equal(insufficient.status, 409)
  assert.equal(insufficient.payload.error.code, 'INSUFFICIENT_STOCK')

  const products = await call('/products', { cookie: admin.cookie })
  assert.equal(products.status, 200)
  assert.equal(products.payload.find((item) => item.id === product.payload.id).stock, 8)
  const movements = await call('/movements', { cookie: admin.cookie })
  assert.equal(movements.status, 200)
  assert.equal(movements.payload.filter((item) => item.productId === product.payload.id).length, 2)

  const report = await call('/reports?period=7d', { cookie: admin.cookie })
  assert.equal(report.status, 200)
  assert.equal(report.payload.summary.entries - reportBaseline.payload.summary.entries, 1)
  assert.equal(report.payload.summary.exits - reportBaseline.payload.summary.exits, 1)
  assert.equal(Number(report.payload.summary.entryCostTotal) - Number(reportBaseline.payload.summary.entryCostTotal), 100)
  assert.equal(Number(report.payload.summary.potentialSaleTotal) - Number(reportBaseline.payload.summary.potentialSaleTotal), 200)
  assert.equal(Number(report.payload.summary.potentialMargin) - Number(reportBaseline.payload.summary.potentialMargin), 100)
  assert.ok(report.payload.products.some((item) => item.id === product.payload.id))

  const packProduct = await call('/products', {
    method: 'POST', cookie: admin.cookie,
    body: {
      code: `QA-FARDO-${suffix}`, name: `Produto em fardo ${suffix}`, categoryId: category.payload.id,
      supplierId: supplier.payload.id, unit: 'Unidade', purchaseUnit: 'Fardo', unitsPerPurchase: 12,
      initialStock: 0, minimum: 0, price: 15,
    },
  })
  assert.equal(packProduct.status, 201)
  assert.equal(packProduct.payload.purchaseUnit, 'Fardo')
  assert.equal(packProduct.payload.unitsPerPurchase, 12)
  const packEntry = await call('/movements', {
    method: 'POST', cookie: admin.cookie,
    body: { productId: packProduct.payload.id, type: 'Entrada', quantity: 2, supplierId: supplier.payload.id, unitCost: 120, unitSalePrice: 15, reason: 'Compra em fardos' },
  })
  assert.equal(packEntry.status, 201)
  assert.equal(packEntry.payload.quantity, 24)
  assert.equal(packEntry.payload.purchaseQuantity, 2)
  assert.equal(packEntry.payload.purchaseUnit, 'Fardo')
  assert.equal(packEntry.payload.purchaseConversion, 12)
  assert.equal(packEntry.payload.purchaseUnitCost, 120)
  await database.query('UPDATE inventory_lots SET unit_cost=NULL WHERE movement_id=$1', [packEntry.payload.id])
  const pendingPack = (await call('/products', { cookie: admin.cookie })).payload.find((item) => item.id === packProduct.payload.id)
  assert.equal(pendingPack.costPending, true)
  assert.equal(pendingPack.unitsPendingCost, 24)
  const assignedPendingCost = await call(`/products/${packProduct.payload.id}/opening-cost`, {
    method: 'PATCH', cookie: admin.cookie,
    body: { unitCost: 10, reason: 'Teste de regularização de lote antigo' },
  })
  assert.equal(assignedPendingCost.status, 200)
  assert.equal(assignedPendingCost.payload.unitsAssigned, 24)
  const regularizedPack = (await call('/products', { cookie: admin.cookie })).payload.find((item) => item.id === packProduct.payload.id)
  assert.equal(regularizedPack.costPending, false)
  assert.equal(Number(regularizedPack.averageCost), 10)
  const packEntries = await call(`/products/${packProduct.payload.id}/entries`, { cookie: admin.cookie })
  assert.equal(packEntries.status, 200)
  assert.equal(packEntries.payload[0].quantity, 24)
  assert.equal(packEntries.payload[0].purchaseQuantity, 2)
  assert.equal(packEntries.payload[0].purchaseUnit, 'Fardo')
  assert.equal(Number(packEntries.payload[0].unitCost), 10)
  assert.equal(Number(packEntries.payload[0].purchaseUnitCost), 120)
  const supplierPackHistory = await call(`/suppliers/${supplier.payload.id}/entries`, { cookie: admin.cookie })
  const regularizedSupplierPurchase = supplierPackHistory.payload.find((entry) => entry.productId === packProduct.payload.id)
  assert.equal(Number(regularizedSupplierPurchase.unitCost), 10)
  assert.equal(Number(regularizedSupplierPurchase.purchaseUnitCost), 120)
  const packSale = await call('/movements', {
    method: 'POST', cookie: admin.cookie,
    body: { productId: packProduct.payload.id, type: 'Saída', quantity: 3, unitSalePrice: 15, reason: 'Venda em unidades' },
  })
  assert.equal(packSale.status, 201)
  assert.equal(packSale.payload.quantity, -3)
  assert.equal(packSale.payload.fifoCost, 30)
  const missingAdjustmentCost = await call('/movements', {
    method: 'POST', cookie: admin.cookie,
    body: { productId: packProduct.payload.id, type: 'Ajuste', adjustment: 1, reason: 'Teste de validação' },
  })
  assert.equal(missingAdjustmentCost.status, 400)
  assert.equal(missingAdjustmentCost.payload.error.code, 'ADJUSTMENT_COST_REQUIRED')
  const costedAdjustment = await call('/movements', {
    method: 'POST', cookie: admin.cookie,
    body: { productId: packProduct.payload.id, type: 'Ajuste', adjustment: 1, unitCost: 8, reason: 'Contagem positiva com custo conhecido' },
  })
  assert.equal(costedAdjustment.status, 201)
  const packProductAfterSale = (await call('/products', { cookie: admin.cookie })).payload.find((item) => item.id === packProduct.payload.id)
  assert.equal(packProductAfterSale.stock, 22)
  assert.equal((await call('/movements', {
    method: 'POST', cookie: admin.cookie,
    body: { productId: packProduct.payload.id, type: 'Saída', quantity: 22, unitSalePrice: 15, reason: 'Encerramento do teste de unidade de compra' },
  })).status, 201)
  assert.equal((await call(`/products/${packProduct.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 204)

  const createdUser = await call('/users', {
    method: 'POST', cookie: admin.cookie,
    body: { name: `Usuário QA ${suffix}`, username: `novo-${suffix}`, email: `novo-${suffix}@example.test`, password: updatedPassword, role: 'operator' },
  })
  assert.equal(createdUser.status, 201)
  assert.equal(createdUser.payload.username, `novo-${suffix}`)
  assert.equal(Object.hasOwn(createdUser.payload, 'mustChangePassword'), false)
  const duplicateUsername = await call('/users', { method: 'POST', cookie: admin.cookie, body: { name: 'Usuário duplicado', username: `novo-${suffix}`, email: `outro-${suffix}@example.test`, password: updatedPassword, role: 'operator' } })
  assert.equal(duplicateUsername.status, 409)
  const createdUserSession = await login(`novo-${suffix}`, updatedPassword)
  assert.equal((await call('/products', { cookie: createdUserSession.cookie })).status, 200)
  const changedUser = await call(`/users/${createdUser.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { role: 'admin', active: true } })
  assert.equal(changedUser.status, 200)
  assert.equal(changedUser.payload.roleKey, 'admin')
  const disabledUser = await call(`/users/${createdUser.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { role: 'operator', active: false } })
  assert.equal(disabledUser.status, 200)
  assert.equal(disabledUser.payload.status, 'Inativo')
  assert.equal((await call('/auth/me', { cookie: createdUserSession.cookie })).status, 401)
  assert.equal((await call(`/users/${createdUser.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { role: 'operator', active: true } })).status, 200)
  assert.equal((await call('/auth/me', { cookie: createdUserSession.cookie })).status, 401)
  assert.equal((await login(`novo-${suffix}`, updatedPassword)).user.roleKey, 'operator')

  const operator = await login(process.env.SEED_OPERATOR_USERNAME, initialPassword)
  assert.equal(operator.user.roleKey, 'operator')
  assert.equal((await call('/products', { cookie: operator.cookie })).status, 200)
  const supplierOptions = await call('/suppliers/options', { cookie: operator.cookie })
  assert.equal(supplierOptions.status, 200)
  assert.deepEqual(Object.keys(supplierOptions.payload[0]).sort(), ['id', 'name'])
  const operatorPasswordUpdate = await call('/auth/change-password', { method: 'POST', cookie: operator.cookie, body: { currentPassword: initialPassword, newPassword: updatedPassword } })
  assert.equal(operatorPasswordUpdate.status, 200)
  operator.cookie = operatorPasswordUpdate.cookie
  assert.equal((await call('/products', { cookie: operator.cookie })).status, 200)
  assert.equal((await call('/users', { cookie: operator.cookie })).status, 403)
  assert.equal((await call('/reports', { cookie: operator.cookie })).status, 403)
  assert.equal((await call('/audit', { cookie: operator.cookie })).status, 403)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/quotes`, { cookie: operator.cookie })).status, 403)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/entries`, { cookie: operator.cookie })).status, 403)
  assert.equal((await call(`/products/${product.payload.id}/suppliers`, { cookie: operator.cookie })).status, 403)
  assert.equal((await upload(`/products/${product.payload.id}/image`, png, 'image/png', operator.cookie)).status, 403)
  assert.equal((await call('/categories', { method: 'POST', cookie: operator.cookie, body: { name: `Proibida ${suffix}` } })).status, 403)

  const operatorEntry = await call('/movements', { method: 'POST', cookie: operator.cookie, body: { productId: product.payload.id, type: 'Entrada', quantity: 1, supplierId: alternateSupplier.payload.id, unitCost: 5, unitSalePrice: 25, reason: 'Entrada pelo operador' } })
  assert.equal(operatorEntry.status, 201)
  const completeEntries = await call(`/products/${product.payload.id}/entries`, { cookie: operator.cookie })
  assert.equal(completeEntries.status, 200)
  assert.equal(completeEntries.payload.length, 2)
  assert.equal(completeEntries.payload[0].supplier, alternateSupplier.payload.name)
  assert.equal(Number(completeEntries.payload[0].unitCost), 5)
  assert.equal(Number(completeEntries.payload[0].unitSalePrice), 25)
  const latestPurchases = await call('/suppliers/last-purchases', { cookie: admin.cookie })
  assert.equal(latestPurchases.status, 200)
  const supplierPrices = latestPurchases.payload.filter((purchase) => purchase.productId === product.payload.id)
  assert.equal(supplierPrices.length, 2)
  assert.equal(Number(supplierPrices.find((purchase) => purchase.supplierId === alternateSupplier.payload.id).unitCost), 5)
  assert.equal(Number(supplierPrices.find((purchase) => purchase.supplierId === supplier.payload.id).unitCost), 10)
  const competitorPrices = await call(`/suppliers/${supplier.payload.id}/comparisons`, { cookie: admin.cookie })
  assert.equal(competitorPrices.status, 200)
  const competingProductPrices = competitorPrices.payload.filter((record) => record.productId === product.payload.id)
  assert.equal(competingProductPrices.length, 2)
  assert.equal(Number(competingProductPrices.find((record) => record.supplierId === alternateSupplier.payload.id).lastPurchaseCost), 5)
  assert.equal(Number(competingProductPrices.find((record) => record.supplierId === alternateSupplier.payload.id).lastQuotePrice), 4.15)
  assert.equal(competingProductPrices.find((record) => record.supplierId === supplier.payload.id).lastQuotePrice, null)
  const productSupplierPrices = await call(`/products/${product.payload.id}/suppliers`, { cookie: admin.cookie })
  assert.equal(productSupplierPrices.status, 200)
  assert.equal(productSupplierPrices.payload.length, 2)
  assert.equal(Number(productSupplierPrices.payload.find((record) => record.supplierId === supplier.payload.id).lastPurchaseCost), 10)
  assert.equal(productSupplierPrices.payload.find((record) => record.supplierId === supplier.payload.id).lastQuotePrice, null)
  assert.equal(Number(productSupplierPrices.payload.find((record) => record.supplierId === alternateSupplier.payload.id).lastPurchaseCost), 5)
  assert.equal(Number(productSupplierPrices.payload.find((record) => record.supplierId === alternateSupplier.payload.id).lastQuotePrice), 4.15)
  assert.equal(productSupplierPrices.payload.find((record) => record.supplierId === supplier.payload.id).purchases.length, 1)
  assert.equal(productSupplierPrices.payload.find((record) => record.supplierId === alternateSupplier.payload.id).quotes.length, 2)
  const secondPurchase = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id, type: 'Entrada', quantity: 1, supplierId: supplier.payload.id, unitCost: 20, unitSalePrice: 25, reason: 'Reposição com custo maior' } })
  assert.equal(secondPurchase.status, 201)
  const updatedSupplierHistory = await call(`/products/${product.payload.id}/suppliers`, { cookie: admin.cookie })
  assert.equal(updatedSupplierHistory.payload.find((record) => record.supplierId === supplier.payload.id).purchases.length, 2)
  const productAfterPurchase = await call('/products', { cookie: admin.cookie })
  const weightedProduct = productAfterPurchase.payload.find((item) => item.id === product.payload.id)
  assert.equal(Number(weightedProduct.averageCost), 10.5)

  const fifoProduct = await call('/products', { method: 'POST', cookie: admin.cookie, body: { code: `FIFO-${suffix}`, name: `Produto FIFO ${suffix}`, categoryId: category.payload.id, unit: 'Fardo', initialStock: 0, minimum: 0, price: 25 } })
  assert.equal(fifoProduct.status, 201)
  assert.equal(fifoProduct.payload.unit, 'Fardo')
  const fifoPurchaseOld = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: fifoProduct.payload.id, type: 'Entrada', quantity: 2, supplierId: supplier.payload.id, unitCost: 10, unitSalePrice: 20, occurredAt: '2026-10-20' } })
  const fifoPurchaseNew = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: fifoProduct.payload.id, type: 'Entrada', quantity: 2, supplierId: alternateSupplier.payload.id, unitCost: 20, unitSalePrice: 30, occurredAt: '2026-10-21' } })
  assert.equal(fifoPurchaseOld.status, 201)
  assert.equal(fifoPurchaseNew.status, 201)
  const fifoSale = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: fifoProduct.payload.id, type: 'Saída', quantity: 3, unitSalePrice: 25, occurredAt: '2026-10-22' } })
  assert.equal(fifoSale.status, 201)
  assert.equal(fifoSale.payload.fifoCost, 40)
  assert.equal(fifoSale.payload.margin, 35)
  const fifoReport = await call(`/reports?period=7d&productId=${fifoProduct.payload.id}`, { cookie: admin.cookie })
  assert.equal(fifoReport.status, 200)
  assert.equal(Number(fifoReport.payload.summary.outgoingCost), 40)
  assert.equal(Number(fifoReport.payload.summary.recordedRevenue), 75)
  assert.equal(Number(fifoReport.payload.summary.realizedMargin), 35)
  assert.equal(Number(fifoReport.payload.summary.remainingCost), 20)
  const fifoProductMargin = fifoReport.payload.productMargins.find((item) => item.productId === fifoProduct.payload.id)
  assert.equal(fifoProductMargin.purchaseCount, 2)
  assert.equal(fifoProductMargin.unitsPurchased, 4)
  assert.equal(Number(fifoProductMargin.purchaseCost), 60)
  assert.equal(fifoProductMargin.saleCount, 1)
  assert.equal(fifoProductMargin.unitsSold, 3)
  assert.equal(Number(fifoProductMargin.fifoCost), 40)
  assert.equal(Number(fifoProductMargin.revenue), 75)
  assert.equal(Number(fifoProductMargin.realizedMargin), 35)
  assert.equal(fifoProductMargin.knownUnits, 1)
  assert.equal(Number(fifoProductMargin.forecastMargin), 10)
  const supplierFifoReport = await call(`/reports?period=7d&productId=${fifoProduct.payload.id}&supplierId=${supplier.payload.id}`, { cookie: admin.cookie })
  assert.equal(supplierFifoReport.payload.summary.unitsOut, 2)
  assert.equal(Number(supplierFifoReport.payload.summary.recordedRevenue), 50)
  assert.equal(Number(supplierFifoReport.payload.summary.outgoingCost), 20)
  assert.equal(Number(supplierFifoReport.payload.summary.realizedMargin), 30)
  const supplierFifoSale = await call(`/reports/product/${fifoProduct.payload.id}/movements?period=7d&supplierId=${supplier.payload.id}`, { cookie: admin.cookie })
  const supplierFifoSaleRow = supplierFifoSale.payload.movements.find((movement) => movement.type.startsWith('Sa'))
  assert.equal(supplierFifoSaleRow.quantity, -2)
  assert.equal(Number(supplierFifoSaleRow.fifoCost), 20)
  const fifoDetailFirstPage = await call(`/reports/product/${fifoProduct.payload.id}/movements?period=7d&page=1&limit=2`, { cookie: admin.cookie })
  assert.equal(fifoDetailFirstPage.status, 200)
  assert.equal(fifoDetailFirstPage.payload.total, 3)
  assert.equal(fifoDetailFirstPage.payload.movements.length, 2)
  const fifoDetailSecondPage = await call(`/reports/product/${fifoProduct.payload.id}/movements?period=7d&page=2&limit=2`, { cookie: admin.cookie })
  assert.equal(fifoDetailSecondPage.payload.movements.length, 1)
  const fifoFullHistory = await call(`/reports/product/${fifoProduct.payload.id}/movements?period=all&limit=25`, { cookie: admin.cookie })
  assert.equal(fifoFullHistory.payload.total, 3)
  const blockedPurchaseReverse = await call(`/movements/${fifoPurchaseOld.payload.id}/reverse`, { method: 'POST', cookie: admin.cookie, body: { reason: 'Teste de proteção contra saída descoberta' } })
  assert.equal(blockedPurchaseReverse.status, 409)
  assert.equal(blockedPurchaseReverse.payload.error.code, 'PURCHASE_CORRECTION_CONFLICT')
  const correctedPurchase = await call(`/movements/${fifoPurchaseOld.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { reason: 'Ajuste da quantidade recebida', quantity: 3, supplierId: supplier.payload.id, unitCost: 10, unitSalePrice: 20, occurredAt: '2026-10-20' } })
  assert.equal(correctedPurchase.status, 200)
  const fifoEntriesAfterCorrection = await call(`/products/${fifoProduct.payload.id}/entries`, { cookie: admin.cookie })
  assert.equal(fifoEntriesAfterCorrection.status, 200)
  assert.equal(fifoEntriesAfterCorrection.payload.find((entry) => entry.id === fifoPurchaseOld.payload.id).quantityRemaining, 0)
  assert.equal(fifoEntriesAfterCorrection.payload.find((entry) => entry.id === fifoPurchaseNew.payload.id).quantityRemaining, 2)
  assert.equal((await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: fifoProduct.payload.id, type: 'Saída', quantity: 2, unitSalePrice: 25 } })).status, 201)
  assert.equal((await call(`/products/${fifoProduct.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 204)

  const belowAverageSale = await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id, type: 'Saída', quantity: 1, unitSalePrice: 9 } })
  assert.equal(belowAverageSale.status, 409)
  assert.equal(belowAverageSale.payload.error.code, 'SALE_BELOW_COST')
  const belowAverageEdit = await call(`/products/${product.payload.id}`, { method: 'PATCH', cookie: admin.cookie, body: { code: product.payload.code, name: changedProduct.payload.name, categoryId: category.payload.id, supplierId: supplier.payload.id, unit: 'Unidade', minimum: 4, price: 10 } })
  assert.equal(belowAverageEdit.status, 409)
  assert.equal((await call(`/suppliers/${alternateSupplier.payload.id}/status`, { method: 'PATCH', cookie: operator.cookie, body: { active: false } })).status, 403)
  assert.equal((await call('/suppliers?status=all', { cookie: operator.cookie })).status, 403)
  assert.equal((await call(`/categories/${category.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 409)
  const audit = await call('/audit', { cookie: admin.cookie })
  assert.equal(audit.status, 200)
  assert.ok(audit.payload.some((item) => item.action === 'registrou movimentação'))

  const preventArchive = await call(`/products/${product.payload.id}`, { method: 'DELETE', cookie: admin.cookie })
  assert.equal(preventArchive.status, 409)
  assert.equal(preventArchive.payload.error.code, 'PRODUCT_HAS_STOCK')
  assert.equal((await call('/movements', { method: 'POST', cookie: admin.cookie, body: { productId: product.payload.id, type: 'Saída', quantity: 10, unitSalePrice: 25, reason: 'Zerar produto de teste' } })).status, 201)
  const deactivate = await call(`/products/${product.payload.id}`, { method: 'DELETE', cookie: admin.cookie })
  assert.equal(deactivate.status, 204)
  assert.equal((await call(`/categories/${category.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 204)
  assert.equal((await call(`/suppliers/${supplier.payload.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 204)
  assert.equal((await call('/auth/logout', { method: 'POST', cookie: operator.cookie })).status, 204)
  assert.equal((await call('/products', { cookie: operator.cookie })).status, 401)
})
