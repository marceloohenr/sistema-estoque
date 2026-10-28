import express from 'express'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from './config.js'
import { database } from './database.js'
import { hashPassword, verifyPassword } from './security.js'

export const app = express()
const PgSessionStore = connectPgSimple(session)
const sessionCookieName = 'estoque.sid'
const roleNames = { admin: 'Administrador', operator: 'Operador de Estoque' }
const uploadsDirectory = resolve(process.env.UPLOADS_DIR || 'uploads')
await mkdir(uploadsDirectory, { recursive: true })

app.disable('x-powered-by')
if (config.trustProxy) app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(express.json({ limit: '100kb' }))
app.use(
  session({
    name: sessionCookieName,
    store: new PgSessionStore({
      pool: database,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
)

app.use('/api', (request, response, next) => {
  const origin = request.get('origin')
  if (origin && origin !== config.appOrigin) {
    return response.status(403).json({
      error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origem da solicitação não permitida.' },
    })
  }
  next()
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'LOGIN_RATE_LIMIT',
      message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    },
  },
})

const productSelect = `
  SELECT p.id, p.code, p.name, p.category_id AS "categoryId", c.name AS category,
         p.supplier_id AS "supplierId", s.name AS supplier, p.unit, p.unit AS "saleUnit",
         p.purchase_unit AS "purchaseUnit", p.units_per_purchase AS "unitsPerPurchase", p.stock,
         p.minimum, p.price, p.average_cost AS "averageCost", CASE WHEN p.image_path IS NULL THEN NULL ELSE '/uploads/' || p.image_path END AS "imageUrl",
         COALESCE((SELECT BOOL_OR(l.quantity_remaining > 0 AND l.unit_cost IS NULL) FROM inventory_lots l WHERE l.product_id=p.id), FALSE) AS "costPending",
         COALESCE((SELECT SUM(l.quantity_remaining) FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0 AND l.unit_cost IS NULL),0)::int AS "unitsPendingCost",
         (SELECT COUNT(*)::int FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0 AND l.unit_cost IS NULL) AS "lotsPendingCost",
         (SELECT SUM(l.quantity_remaining * l.unit_cost) FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0 AND l.unit_cost IS NOT NULL) AS "remainingCost",
         (SELECT l.unit_cost FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0 ORDER BY l.occurred_at,l.id LIMIT 1) AS "nextFifoCost",
         (SELECT MAX(l.unit_cost) FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0) AS "highestRemainingCost",
         COALESCE((SELECT SUM(l.quantity_remaining) FROM inventory_lots l WHERE l.product_id=p.id AND l.quantity_remaining>0 AND l.unit_cost>p.price),0)::int AS "unitsBelowSaleCost",
         CASE WHEN p.active THEN 'Ativo' ELSE 'Inativo' END AS status
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function requiredString(value, field, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      `O campo ${field} é obrigatório e deve ter até ${maxLength} caracteres.`,
    )
  }
  return value.trim()
}

function optionalString(value, field, maxLength = 500) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      `O campo ${field} deve ter até ${maxLength} caracteres.`,
    )
  }
  return value.trim()
}

function optionalEmail(value, field = 'e-mail') {
  const email = optionalString(value, field, 254).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'INVALID_EMAIL', 'Informe um endereço de e-mail válido.')
  }
  return email
}

function positiveId(value, field) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1)
    throw httpError(400, 'VALIDATION_ERROR', `O campo ${field} é inválido.`)
  return id
}

function reportPeriod(query, { allowAll = false } = {}) {
  const period = query.period ?? '30d'
  const intervals = { '7d': 7, '30d': 30 }
  const localDate = (date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Fortaleza',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(date)
        .map(({ type, value }) => [type, value]),
    )
  const formatDate = ({ year, month, day }) => `${year}-${month}-${day}`
  if (period === 'month') {
    const parts = localDate(new Date())
    return {
      period,
      fromDate: `${parts.year}-${parts.month}-01`,
      toDate: formatDate(parts),
      interval: null,
      all: false,
    }
  }
  if (intervals[period]) {
    const parts = localDate(new Date())
    const end = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - intervals[period] + 1)
    return {
      period,
      fromDate: formatDate(localDate(start)),
      toDate: formatDate(parts),
      interval: null,
      all: false,
    }
  }
  if (period === 'custom') {
    const fromDate = query.from
    const toDate = query.to
    const validDate = (value) =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    if (!validDate(fromDate) || !validDate(toDate)) {
      throw httpError(
        400,
        'INVALID_PERIOD',
        'Informe uma data inicial e final válidas para o relatório.',
      )
    }
    if (fromDate > toDate)
      throw httpError(400, 'INVALID_PERIOD', 'A data inicial não pode ser posterior à data final.')
    return { period, fromDate, toDate, interval: null, all: false }
  }
  if (allowAll && period === 'all')
    return { period, fromDate: null, toDate: null, interval: null, all: true }
  throw httpError(400, 'INVALID_PERIOD', 'Selecione um período válido.')
}

function integer(value, field, { minimum = 0, allowNegative = false } = {}) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (allowNegative ? number === 0 : number < minimum)) {
    throw httpError(400, 'VALIDATION_ERROR', `O campo ${field} deve ser um número inteiro válido.`)
  }
  return number
}

function money(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'O preço deve ser um valor monetário igual ou maior que zero.',
    )
  }
  return amount.toFixed(2)
}

function optionalMoney(value) {
  if (value == null || value === '') return null
  return money(value)
}

const imageTypes = {
  'image/jpeg': {
    extension: 'jpg',
    matches: (file) => file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff,
  },
  'image/png': {
    extension: 'png',
    matches: (file) =>
      file.length >= 8 &&
      file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/webp': {
    extension: 'webp',
    matches: (file) =>
      file.length >= 12 &&
      file.toString('ascii', 0, 4) === 'RIFF' &&
      file.toString('ascii', 8, 12) === 'WEBP',
  },
}
const rawImage = express.raw({ type: () => true, limit: '5mb' })

function uploadImage(table) {
  return async (request, response) => {
    const id = positiveId(request.params.id, 'cadastro')
    const contentType = request.get('content-type')?.split(';')[0].trim().toLowerCase()
    const imageType = imageTypes[contentType]
    if (!imageType || !Buffer.isBuffer(request.body) || !imageType.matches(request.body)) {
      throw httpError(415, 'INVALID_IMAGE', 'Envie uma imagem JPEG, PNG ou WebP válida.')
    }

    const filename = `${randomUUID()}.${imageType.extension}`
    const filePath = resolve(uploadsDirectory, filename)
    await writeFile(filePath, request.body, { flag: 'wx', mode: 0o640 })
    try {
      const result = await withTransaction(async (client) => {
        const current = await client.query(
          `SELECT image_path FROM ${table} WHERE id=$1 AND active=TRUE FOR UPDATE`,
          [id],
        )
        if (!current.rows[0])
          throw httpError(404, 'RECORD_NOT_FOUND', 'Cadastro não encontrado ou inativo.')
        const { rows } = await client.query(
          `UPDATE ${table} SET image_path=$1, updated_at=NOW() WHERE id=$2 AND active=TRUE RETURNING image_path`,
          [filename, id],
        )
        await audit(
          client,
          request,
          'atualizou imagem',
          table === 'products' ? 'produto' : 'fornecedor',
          id,
        )
        return { ...rows[0], previousImage: current.rows[0].image_path }
      })
      if (result.previousImage && /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(result.previousImage)) {
        await unlink(resolve(uploadsDirectory, result.previousImage)).catch(() => {})
      }
      response.json({ imageUrl: `/uploads/${result.image_path}` })
    } catch (error) {
      await unlink(filePath).catch(() => {})
      throw error
    }
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: roleNames[user.role],
    roleKey: user.role,
    status: user.active ? 'Ativo' : 'Inativo',
  }
}

async function requireAuth(request, _response, next) {
  try {
    if (request.user) return next()
    if (!request.session.userId) throw httpError(401, 'AUTH_REQUIRED', 'Faça login para continuar.')
    const { rows } = await database.query(
      'SELECT id, name, username, email, role, active, session_version FROM users WHERE id = $1',
      [request.session.userId],
    )
    const user = rows[0]
    if (!user?.active || Number(request.session.sessionVersion) !== Number(user.session_version)) {
      await new Promise((resolve) => request.session.destroy(() => resolve()))
      throw httpError(401, 'AUTH_REQUIRED', 'Sua sessão expirou. Entre novamente.')
    }
    request.user = user
    next()
  } catch (error) {
    next(error)
  }
}

function requireAdmin(request, _response, next) {
  if (request.user?.role !== 'admin')
    return next(httpError(403, 'FORBIDDEN', 'Esta ação exige perfil de administrador.'))
  next()
}

async function withTransaction(callback) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function audit(client, request, action, entity, entityId, details = {}) {
  await client.query(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [request.user.id, action, entity, entityId ?? null, JSON.stringify(details)],
  )
}

const stockTimeZone = 'America/Fortaleza'

// Componentes de data e hora no fuso do armazém.
function zonedParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: stockTimeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  )
}

// Deslocamento do fuso em relação ao UTC, em milissegundos.
function zoneOffset(date) {
  const parts = zonedParts(date)
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ) -
    Math.floor(date.getTime() / 1000) * 1000
  )
}

// Combina o dia informado com a hora local atual para gravar o instante correto.
function movementTimestamp(value, now = new Date()) {
  if (value == null || value === '') return now
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw httpError(
      400,
      'INVALID_DATE',
      'Informe uma data v\u00e1lida para a movimenta\u00e7\u00e3o.',
    )
  const [year, month, day] = value.split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== value)
    throw httpError(
      400,
      'INVALID_DATE',
      'Informe uma data v\u00e1lida para a movimenta\u00e7\u00e3o.',
    )
  const wallClock = zonedParts(now)
  const target = Date.UTC(
    year,
    month - 1,
    day,
    Number(wallClock.hour),
    Number(wallClock.minute),
    Number(wallClock.second),
    now.getMilliseconds(),
  )
  // Recalcula o deslocamento para datas que atravessem uma mudança de fuso.
  let instant = target - zoneOffset(new Date(target))
  instant = target - zoneOffset(new Date(instant))
  return new Date(instant)
}

async function recordLotMovement(
  client,
  {
    productId,
    userId,
    type,
    quantity,
    reason,
    supplierId = null,
    unitCost = null,
    unitSalePrice = null,
    occurredAt = new Date(),
    purchaseDetails = null,
    openingBalance = false,
  },
) {
  const { rows } = await client.query(
    'SELECT id, stock, price, unit, purchase_unit, units_per_purchase FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',
    [productId],
  )
  const product = rows[0]
  if (!product) throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto n\u00e3o encontrado ou inativo.')
  if (type === 'Entrada') {
    const conversion = Number(purchaseDetails?.conversion ?? product.units_per_purchase)
    const packageQuantity = Number(purchaseDetails?.quantity ?? quantity)
    const packageCost = Number(purchaseDetails?.unitCost ?? unitCost)
    if (
      !Number.isSafeInteger(packageQuantity * conversion) ||
      packageQuantity * conversion > 2147483647
    )
      throw httpError(400, 'VALIDATION_ERROR', 'A quantidade convertida excede o limite permitido.')
    purchaseDetails = {
      quantity: packageQuantity,
      unit: purchaseDetails?.unit ?? product.purchase_unit,
      conversion,
      unitCost: packageCost,
    }
    quantity = packageQuantity * conversion
    unitCost = Number((packageCost / conversion).toFixed(2))
  }
  const newStock = Number(product.stock) + quantity
  if (newStock < 0)
    throw httpError(
      409,
      'INSUFFICIENT_STOCK',
      'N\u00e3o h\u00e1 saldo suficiente para esta opera\u00e7\u00e3o.',
    )
  if (
    type === 'Entrada' &&
    (unitCost == null ||
      (!openingBalance && (!supplierId || unitSalePrice == null || Number(unitSalePrice) <= 0)))
  )
    throw httpError(
      400,
      'ENTRY_VALUES_REQUIRED',
      'Informe fornecedor, custo de entrada e pre\u00e7o de venda para registrar a compra.',
    )
  if (type === 'Ajuste' && quantity > 0 && unitCost == null)
    throw httpError(
      400,
      'ADJUSTMENT_COST_REQUIRED',
      'Informe o custo unit\u00e1rio das unidades acrescentadas ao saldo.',
    )
  if (type === 'Sa\u00edda' && unitSalePrice == null) unitSalePrice = product.price
  if (type === 'Sa\u00edda' && (!unitSalePrice || Number(unitSalePrice) <= 0))
    throw httpError(400, 'SALE_PRICE_REQUIRED', 'Informe o pre\u00e7o de venda desta sa\u00edda.')
  if (supplierId) {
    const valid = await client.query(
      'SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR SHARE',
      [supplierId],
    )
    if (!valid.rowCount) throw httpError(400, 'INVALID_SUPPLIER', 'Selecione um fornecedor ativo.')
  }
  const salePrice =
    type === 'Entrada' && openingBalance && unitSalePrice == null
      ? null
      : type === 'Entrada' || type === 'Sa\u00edda'
        ? Number(unitSalePrice ?? product.price)
        : null
  const { rows: created } = await client.query(
    `INSERT INTO movements (product_id,user_id,type,quantity,reason,supplier_id,unit_cost,unit_sale_price,occurred_at,purchase_quantity,purchase_unit,purchase_conversion,purchase_unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id,product_id AS \"productId\",type,quantity,reason,occurred_at AS date`,
    [
      productId,
      userId,
      type,
      quantity,
      reason,
      supplierId,
      unitCost,
      salePrice,
      occurredAt,
      purchaseDetails?.quantity ?? null,
      purchaseDetails?.unit ?? null,
      purchaseDetails?.conversion ?? null,
      purchaseDetails?.unitCost ?? null,
    ],
  )
  const movement = created[0]
  if (type === 'Entrada' || (type === 'Ajuste' && quantity > 0)) {
    await client.query(
      `INSERT INTO inventory_lots (movement_id,product_id,supplier_id,quantity_received,quantity_remaining,unit_cost,unit_sale_price,occurred_at,source)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)`,
      [
        movement.id,
        productId,
        supplierId,
        quantity,
        type === 'Entrada' || type === 'Ajuste' ? unitCost : null,
        salePrice,
        occurredAt,
        type === 'Entrada' ? 'purchase' : 'adjustment',
      ],
    )
    if (type === 'Entrada') {
      const later = await client.query(
        'SELECT 1 FROM movements WHERE product_id=$1 AND id<>$2 AND voided_at IS NULL AND (occurred_at>$3 OR (occurred_at=$3 AND id>$2)) LIMIT 1',
        [productId, movement.id, occurredAt],
      )
      if (later.rowCount) await rebuildProductLots(client, productId, newStock)
    }
  } else if (type === 'Sa\u00edda' || (type === 'Ajuste' && quantity < 0)) {
    let remaining = Math.abs(quantity)
    const { rows: lots } = await client.query(
      `SELECT id,quantity_remaining AS quantity,unit_cost AS \"unitCost\" FROM inventory_lots
       WHERE product_id=$1 AND quantity_remaining>0 ORDER BY occurred_at,id FOR UPDATE`,
      [productId],
    )
    let totalCost = 0
    const allocations = []
    for (const lot of lots) {
      if (!remaining) break
      const taken = Math.min(remaining, Number(lot.quantity))
      if (lot.unitCost == null && type === 'Sa\u00edda')
        throw httpError(
          409,
          'COST_BASELINE_REQUIRED',
          'Existem unidades sem custo conhecido. Informe o custo pendente antes de registrar uma sa\u00edda.',
        )
      totalCost += taken * (lot.unitCost == null ? 0 : Number(lot.unitCost))
      allocations.push({
        id: lot.id,
        quantity: taken,
        unitCost: lot.unitCost == null ? null : Number(lot.unitCost),
      })
      remaining -= taken
    }
    if (remaining)
      throw httpError(
        409,
        'INSUFFICIENT_STOCK',
        'Os lotes dispon\u00edveis n\u00e3o cobrem esta opera\u00e7\u00e3o.',
      )
    const fifoCost = totalCost / Math.abs(quantity)
    if (type === 'Sa\u00edda' && salePrice < fifoCost)
      throw httpError(
        409,
        'SALE_BELOW_COST',
        `O pre\u00e7o informado fica abaixo do custo FIFO de ${fifoCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      )
    for (const allocation of allocations) {
      await client.query(
        'UPDATE inventory_lots SET quantity_remaining=quantity_remaining-$1 WHERE id=$2',
        [allocation.quantity, allocation.id],
      )
      await client.query(
        'INSERT INTO movement_lot_allocations (movement_id,lot_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)',
        [movement.id, allocation.id, allocation.quantity, allocation.unitCost],
      )
    }
  }
  const { rows: cost } = await client.query(
    `SELECT CASE WHEN BOOL_OR(quantity_remaining>0 AND unit_cost IS NULL) THEN NULL
                 ELSE SUM(quantity_remaining*unit_cost)/NULLIF(SUM(quantity_remaining),0) END AS average
     FROM inventory_lots WHERE product_id=$1`,
    [productId],
  )
  await client.query(
    `UPDATE products SET stock=$1,average_cost=$2,price=CASE WHEN $3='Entrada' THEN COALESCE($4::numeric,price) ELSE price END,updated_at=NOW() WHERE id=$5`,
    [newStock, newStock === 0 ? 0 : cost[0].average, type, salePrice, productId],
  )
  if (supplierId)
    await client.query(
      'INSERT INTO product_suppliers(product_id,supplier_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [productId, supplierId],
    )
  const { rows: spent } = await client.query(
    'SELECT COALESCE(SUM(quantity*unit_cost),0) AS cost FROM movement_lot_allocations WHERE movement_id=$1',
    [movement.id],
  )
  const fifoCost = Number(spent[0].cost)
  await audit(
    client,
    { user: { id: userId } },
    'registrou movimenta\u00e7\u00e3o',
    'estoque',
    productId,
    { type, quantity, reason, supplierId, unitCost, salePrice, occurredAt, fifoCost },
  )
  return {
    ...movement,
    purchaseQuantity: purchaseDetails?.quantity ?? null,
    purchaseUnit: purchaseDetails?.unit ?? null,
    purchaseConversion: purchaseDetails?.conversion ?? null,
    purchaseUnitCost: purchaseDetails?.unitCost ?? null,
    fifoCost,
    margin:
      type === 'Sa\u00edda' ? Number((Math.abs(quantity) * salePrice - fifoCost).toFixed(2)) : null,
  }
}

async function rebuildProductLots(client, productId, targetStock) {
  const { rows: previousLots } = await client.query(
    'SELECT movement_id,source,unit_cost FROM inventory_lots WHERE product_id=$1 AND unit_cost IS NOT NULL',
    [productId],
  )
  const openingCost = previousLots.find((lot) => lot.source === 'opening')?.unit_cost ?? null
  const adjustmentCosts = new Map(
    previousLots
      .filter((lot) => lot.source === 'adjustment')
      .map((lot) => [String(lot.movement_id), lot.unit_cost]),
  )
  const { rows: history } = await client.query(
    `SELECT id,type,quantity,supplier_id AS \"supplierId\",unit_cost AS \"unitCost\",unit_sale_price AS \"unitSalePrice\",occurred_at AS date
     FROM movements WHERE product_id=$1 AND voided_at IS NULL ORDER BY occurred_at,id`,
    [productId],
  )
  let net = 0
  let minPrefix = 0
  for (const row of history) {
    net += Number(row.quantity)
    minPrefix = Math.min(minPrefix, net)
  }
  const opening = Number(targetStock) - net
  if (opening < -minPrefix)
    throw httpError(
      409,
      'PURCHASE_CORRECTION_CONFLICT',
      'A correção deixaria uma saída histórica sem quantidade disponível.',
    )
  await client.query('DELETE FROM inventory_lots WHERE product_id=$1', [productId])
  const layers = []
  if (opening > 0) {
    const first = history[0]?.date ? new Date(new Date(history[0].date).valueOf() - 1) : new Date()
    const { rows } = await client.query(
      `INSERT INTO inventory_lots (product_id,quantity_received,quantity_remaining,unit_cost,occurred_at,source)
       VALUES ($1,$2,$2,$4,$3,'opening') RETURNING id,quantity_remaining AS quantity,unit_cost AS cost,occurred_at AS date`,
      [productId, opening, first, openingCost],
    )
    layers.push(rows[0])
  }
  for (const movement of history) {
    const amount = Number(movement.quantity)
    if (movement.type === 'Entrada' || (movement.type === 'Ajuste' && amount > 0)) {
      const { rows } = await client.query(
        `INSERT INTO inventory_lots (movement_id,product_id,supplier_id,quantity_received,quantity_remaining,unit_cost,unit_sale_price,occurred_at,source)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING id,quantity_remaining AS quantity,unit_cost AS cost,occurred_at AS date`,
        [
          movement.id,
          productId,
          movement.supplierId,
          amount,
          movement.type === 'Entrada'
            ? movement.unitCost
            : (adjustmentCosts.get(String(movement.id)) ?? null),
          movement.unitSalePrice,
          movement.date,
          movement.type === 'Entrada' ? 'purchase' : 'adjustment',
        ],
      )
      layers.push(rows[0])
    } else {
      let needed = Math.abs(amount)
      for (const layer of layers) {
        if (!needed) break
        const used = Math.min(needed, Number(layer.quantity))
        if (!used) continue
        layer.quantity = Number(layer.quantity) - used
        await client.query('UPDATE inventory_lots SET quantity_remaining=$1 WHERE id=$2', [
          layer.quantity,
          layer.id,
        ])
        await client.query(
          'INSERT INTO movement_lot_allocations (movement_id,lot_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)',
          [movement.id, layer.id, used, layer.cost],
        )
        needed -= used
      }
      if (needed)
        throw httpError(
          409,
          'PURCHASE_CORRECTION_CONFLICT',
          'A correção deixaria uma saída histórica sem quantidade disponível.',
        )
    }
  }
  const { rows: updated } = await client.query(
    `UPDATE products SET stock=$1,
       average_cost=CASE WHEN $1=0 THEN 0 WHEN EXISTS(SELECT 1 FROM inventory_lots WHERE product_id=$2 AND quantity_remaining>0 AND unit_cost IS NULL) THEN NULL
         ELSE (SELECT SUM(quantity_remaining*unit_cost)/NULLIF(SUM(quantity_remaining),0) FROM inventory_lots WHERE product_id=$2) END,
       updated_at=NOW() WHERE id=$2 RETURNING stock`,
    [targetStock, productId],
  )
  return updated[0].stock
}

app.get('/api/health', async (_request, response) => {
  try {
    await database.query('SELECT 1')
    return response
      .status(200)
      .json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() })
  } catch {
    return response
      .status(503)
      .json({ status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() })
  }
})

app.get('/api/dashboard', requireAuth, async (_request, response) => {
  const today = await database.query(
    `SELECT COUNT(*)::int AS total FROM movements m
     WHERE (m.occurred_at AT TIME ZONE 'America/Fortaleza')::date = (NOW() AT TIME ZONE 'America/Fortaleza')::date`,
  )
  const week = await database.query(
    `WITH days AS (
       SELECT generate_series((NOW() AT TIME ZONE 'America/Fortaleza')::date-6,(NOW() AT TIME ZONE 'America/Fortaleza')::date,INTERVAL '1 day')::date AS day
     ), daily AS (
       SELECT (m.occurred_at AT TIME ZONE 'America/Fortaleza')::date AS day,
              COALESCE(SUM(ABS(m.quantity)) FILTER(WHERE m.type='Entrada'),0)::int AS entries,
              COALESCE(SUM(ABS(m.quantity)) FILTER(WHERE m.type='Saída'),0)::int AS exits
       FROM movements m
       WHERE m.occurred_at >= NOW()-INTERVAL '8 days' AND m.type IN ('Entrada','Saída')
       GROUP BY (m.occurred_at AT TIME ZONE 'America/Fortaleza')::date
     )
     SELECT TO_CHAR(days.day,'YYYY-MM-DD') AS key,COALESCE(daily.entries,0)::int AS entries,COALESCE(daily.exits,0)::int AS exits
     FROM days LEFT JOIN daily USING(day) ORDER BY days.day`,
  )
  const recent = await database.query(
    `SELECT m.id,m.product_id AS "productId",m.type,m.quantity,p.unit,u.name AS "user",m.occurred_at AS date,
            m.voided_at AS "voidedAt"
     FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id
     ORDER BY m.occurred_at DESC,m.id DESC LIMIT 5`,
  )
  response.json({ todayCount: today.rows[0].total, week: week.rows, recent: recent.rows })
})

app.use(
  '/uploads',
  requireAuth,
  express.static(uploadsDirectory, {
    dotfiles: 'deny',
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders: (response) =>
      response.setHeader('Cache-Control', 'private, max-age=86400, immutable'),
    fallthrough: true,
  }),
)

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  const username =
    typeof request.body?.username === 'string' ? request.body.username.trim().toLowerCase() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const { rows } = await database.query(
    'SELECT * FROM users WHERE LOWER(username) = $1 AND active = TRUE',
    [username],
  )
  const user = rows[0]
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return response
      .status(401)
      .json({ error: { code: 'INVALID_CREDENTIALS', message: 'Usuário ou senha inválidos.' } })
  }

  await new Promise((resolve, reject) =>
    request.session.regenerate((error) => (error ? reject(error) : resolve())),
  )
  request.session.userId = user.id
  request.session.sessionVersion = user.session_version
  await new Promise((resolve, reject) =>
    request.session.save((error) => (error ? reject(error) : resolve())),
  )
  return response.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', async (request, response, next) => {
  if (!request.session) return response.status(204).end()
  request.session.destroy((error) => {
    if (error) return next(error)
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
    })
    response.status(204).end()
  })
})

app.get('/api/auth/me', requireAuth, (request, response) =>
  response.json({ user: publicUser(request.user) }),
)

app.post('/api/auth/change-password', requireAuth, async (request, response) => {
  const currentPassword = request.body?.currentPassword
  const newPassword = request.body?.newPassword
  if (
    typeof currentPassword !== 'string' ||
    !currentPassword ||
    typeof newPassword !== 'string' ||
    !newPassword
  ) {
    throw httpError(400, 'VALIDATION_ERROR', 'Informe a senha atual e a nova senha.')
  }
  if (newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    throw httpError(400, 'WEAK_PASSWORD', 'A nova senha deve ter entre 12 e 72 bytes.')
  }
  const { rows } = await database.query('SELECT password_hash FROM users WHERE id = $1', [
    request.user.id,
  ])
  if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
    throw httpError(400, 'CURRENT_PASSWORD_INVALID', 'A senha atual não confere.')
  }
  if (await verifyPassword(newPassword, rows[0].password_hash)) {
    throw httpError(400, 'PASSWORD_UNCHANGED', 'Escolha uma senha diferente da atual.')
  }
  const sessionVersion = await withTransaction(async (client) => {
    const { rows: updatedRows } = await client.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, session_version = session_version + 1, updated_at = NOW() WHERE id = $2 RETURNING session_version',
      [await hashPassword(newPassword), request.user.id],
    )
    await audit(client, request, 'alterou a própria senha', 'usuário', request.user.id)
    return updatedRows[0].session_version
  })
  await new Promise((resolve, reject) =>
    request.session.regenerate((error) => (error ? reject(error) : resolve())),
  )
  request.session.userId = request.user.id
  request.session.sessionVersion = sessionVersion
  await new Promise((resolve, reject) =>
    request.session.save((error) => (error ? reject(error) : resolve())),
  )
  return response.json({ user: publicUser(request.user), message: 'Senha alterada com sucesso.' })
})

app.get('/api/products', requireAuth, async (request, response) => {
  const status = request.query.status ?? 'active'
  if (!['active', 'inactive', 'all'].includes(status))
    throw httpError(400, 'INVALID_STATUS', 'Selecione uma situação válida para os produtos.')
  if (status !== 'active' && request.user.role !== 'admin')
    throw httpError(403, 'FORBIDDEN', 'Esta ação exige perfil de administrador.')
  const activeFilter = status === 'all' ? 'TRUE' : status === 'inactive' ? 'FALSE' : 'TRUE'
  const { rows } = await database.query(
    `${productSelect} WHERE p.active = ${activeFilter} ORDER BY p.name`,
  )
  response.json(rows.map((row) => ({ ...row, price: Number(row.price) })))
})

app.get('/api/products/search', requireAuth, async (request, response) => {
  const status = request.query.status ?? 'active'
  if (!['active', 'inactive', 'all'].includes(status))
    throw httpError(400, 'INVALID_STATUS', 'Selecione uma situação válida para os produtos.')
  if (status !== 'active' && request.user.role !== 'admin')
    throw httpError(403, 'FORBIDDEN', 'Esta ação exige perfil de administrador.')
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '25', 10) || 25))
  const offset = (page - 1) * limit
  const search = optionalString(request.query.search, 'busca', 160)
  const categoryId = request.query.categoryId
    ? positiveId(request.query.categoryId, 'categoria')
    : null
  const pattern = search ? `%${search}%` : null
  const statusFilter =
    status === 'all' ? 'TRUE' : status === 'inactive' ? 'p.active=FALSE' : 'p.active=TRUE'
  const filters = `${statusFilter} AND ($1::text IS NULL OR p.name ILIKE $1 OR p.code ILIKE $1 OR c.name ILIKE $1) AND ($2::int IS NULL OR p.category_id=$2)`
  const [count, result, statusCounts] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${filters}`,
      [pattern, categoryId],
    ),
    database.query(`${productSelect} WHERE ${filters} ORDER BY p.name,p.id LIMIT $3 OFFSET $4`, [
      pattern,
      categoryId,
      limit,
      offset,
    ]),
    database.query(
      'SELECT COUNT(*) FILTER(WHERE active=TRUE)::int AS active,COUNT(*) FILTER(WHERE active=FALSE)::int AS inactive,COUNT(*)::int AS total FROM products',
    ),
  ])
  response.json({
    page,
    limit,
    total: count.rows[0].total,
    counts: statusCounts.rows[0],
    products: result.rows.map((row) => ({ ...row, price: Number(row.price) })),
  })
})

app.get('/api/products/:id/entries', requireAuth, async (request, response) => {
  const productId = positiveId(request.params.id, 'produto')
  const product = await database.query('SELECT id FROM products WHERE id=$1 AND active=TRUE', [
    productId,
  ])
  if (!product.rowCount)
    throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo.')
  const { rows } = await database.query(
    `SELECT m.id, m.quantity, p.unit, COALESCE(m.purchase_quantity,m.quantity) AS "purchaseQuantity",
            COALESCE(m.purchase_unit,p.unit) AS "purchaseUnit", COALESCE(m.purchase_conversion,1) AS "purchaseConversion",
            COALESCE(m.purchase_unit_cost,m.unit_cost) AS "purchaseUnitCost", m.reason, m.occurred_at AS date,m.voided_at AS "voidedAt",m.void_reason AS "voidReason",m.supplier_id AS "supplierId",
            l.quantity_remaining AS "quantityRemaining",
            s.name AS supplier, m.unit_cost AS "unitCost", m.unit_sale_price AS "unitSalePrice",
            m.quantity * m.unit_cost AS "totalCost",
            m.quantity * m.unit_sale_price AS "potentialSaleTotal"
     FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN suppliers s ON s.id=m.supplier_id LEFT JOIN inventory_lots l ON l.movement_id=m.id
     WHERE m.product_id=$1 AND m.type='Entrada'
     ORDER BY m.occurred_at DESC, m.id DESC`,
    [productId],
  )
  response.json(rows)
})

app.get('/api/products/:id/fifo-preview', requireAuth, async (request, response) => {
  const productId = positiveId(request.params.id, 'produto')
  const quantity = integer(request.query.quantity, 'quantidade', { minimum: 1 })
  const product = await database.query('SELECT stock FROM products WHERE id=$1 AND active=TRUE', [
    productId,
  ])
  if (!product.rowCount)
    throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo.')
  const { rows } = await database.query(
    `SELECT l.id,l.quantity_remaining AS "quantityRemaining",l.unit_cost AS "unitCost",l.occurred_at AS date,s.name AS supplier
     FROM inventory_lots l LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE l.product_id=$1 AND l.quantity_remaining>0 ORDER BY l.occurred_at,l.id`,
    [productId],
  )
  let remaining = quantity
  const allocations = []
  for (const lot of rows) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Number(lot.quantityRemaining))
    allocations.push({
      id: lot.id,
      quantity: take,
      unitCost: lot.unitCost == null ? null : Number(lot.unitCost),
      date: lot.date,
      supplier: lot.supplier,
    })
    remaining -= take
  }
  const costPending = allocations.some((lot) => lot.unitCost == null)
  const cost = costPending
    ? null
    : allocations.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0)
  response.json({
    productId,
    quantity,
    available: Number(product.rows[0].stock),
    sufficientStock: remaining === 0,
    costPending,
    cost,
    allocations,
  })
})

app.get('/api/products/:id/suppliers', requireAuth, requireAdmin, async (request, response) => {
  const productId = positiveId(request.params.id, 'produto')
  const product = await database.query('SELECT id FROM products WHERE id=$1 AND active=TRUE', [
    productId,
  ])
  if (!product.rowCount)
    throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo.')
  const { rows } = await database.query(
    `WITH supplier_ids AS (
       SELECT supplier_id FROM product_suppliers WHERE product_id=$1
       UNION SELECT supplier_id FROM products WHERE id=$1 AND supplier_id IS NOT NULL
       UNION SELECT supplier_id FROM movements WHERE product_id=$1 AND supplier_id IS NOT NULL
       UNION SELECT supplier_id FROM supplier_quotes WHERE product_id=$1
     ), latest_purchases AS (
       SELECT DISTINCT ON (m.supplier_id) m.supplier_id, m.quantity, m.unit_cost, m.occurred_at
       FROM movements m
       WHERE m.product_id=$1 AND m.type='Entrada' AND m.supplier_id IS NOT NULL AND m.voided_at IS NULL
       ORDER BY m.supplier_id, m.occurred_at DESC, m.id DESC
     ), latest_quotes AS (
       SELECT DISTINCT ON (q.supplier_id) q.supplier_id, q.unit_price, q.quoted_at
       FROM supplier_quotes q
       WHERE q.product_id=$1
       ORDER BY q.supplier_id, q.quoted_at DESC, q.id DESC
     )
     SELECT s.id AS "supplierId", s.name AS supplier, s.active AS "supplierActive",
            lp.quantity AS "lastPurchaseQuantity", lp.unit_cost AS "lastPurchaseCost", lp.occurred_at AS "lastPurchaseDate",
            lq.unit_price AS "lastQuotePrice", lq.quoted_at AS "lastQuoteDate"
     FROM supplier_ids ps
     JOIN suppliers s ON s.id=ps.supplier_id
     LEFT JOIN latest_purchases lp ON lp.supplier_id=s.id
     LEFT JOIN latest_quotes lq ON lq.supplier_id=s.id
     ORDER BY s.active DESC, s.name`,
    [productId],
  )
  const [purchaseHistory, quoteHistory] = await Promise.all([
    database.query(
      `SELECT m.id, m.supplier_id AS "supplierId", s.name AS supplier, m.quantity,
              m.unit_cost AS "unitCost", m.unit_sale_price AS "unitSalePrice", m.occurred_at AS date,
              m.voided_at AS "voidedAt", m.void_reason AS "voidReason"
       FROM movements m JOIN suppliers s ON s.id=m.supplier_id
       WHERE m.product_id=$1 AND m.type='Entrada' AND m.supplier_id IS NOT NULL
       ORDER BY m.occurred_at DESC, m.id DESC`,
      [productId],
    ),
    database.query(
      `SELECT q.id, q.supplier_id AS "supplierId", s.name AS supplier, q.unit_price AS "unitPrice",
              q.quoted_at AS date, q.note
       FROM supplier_quotes q JOIN suppliers s ON s.id=q.supplier_id
       WHERE q.product_id=$1
       ORDER BY q.quoted_at DESC, q.id DESC`,
      [productId],
    ),
  ])
  response.json(
    rows.map((row) => ({
      ...row,
      lastPurchaseCost: row.lastPurchaseCost == null ? null : Number(row.lastPurchaseCost),
      lastQuotePrice: row.lastQuotePrice == null ? null : Number(row.lastQuotePrice),
      purchases: purchaseHistory.rows
        .filter((entry) => entry.supplierId === row.supplierId)
        .map((entry) => ({
          ...entry,
          unitCost: entry.unitCost == null ? null : Number(entry.unitCost),
          unitSalePrice: entry.unitSalePrice == null ? null : Number(entry.unitSalePrice),
        })),
      quotes: quoteHistory.rows
        .filter((entry) => entry.supplierId === row.supplierId)
        .map((entry) => ({
          ...entry,
          unitPrice: Number(entry.unitPrice),
        })),
    })),
  )
})

app.put('/api/products/:id/image', requireAuth, requireAdmin, rawImage, uploadImage('products'))

app.post('/api/products', requireAuth, requireAdmin, async (request, response) => {
  const code = requiredString(request.body?.code, 'código', 50).toUpperCase()
  const name = requiredString(request.body?.name, 'nome', 160)
  const categoryId = positiveId(request.body?.categoryId, 'categoria')
  const supplierId = request.body?.supplierId
    ? positiveId(request.body.supplierId, 'fornecedor')
    : null
  const unit = requiredString(request.body?.unit, 'unidade', 30)
  const purchaseUnit = requiredString(request.body?.purchaseUnit ?? unit, 'medida de compra', 30)
  const unitsPerPurchase = integer(
    request.body?.unitsPerPurchase ?? 1,
    'unidades por medida de compra',
    { minimum: 1 },
  )
  if (unit === purchaseUnit && unitsPerPurchase !== 1)
    throw httpError(
      400,
      'INVALID_UNIT_CONVERSION',
      'Use conversão 1 quando as medidas de compra e venda forem iguais.',
    )
  const minimum = integer(request.body?.minimum ?? 0, 'estoque mínimo')
  const price = money(request.body?.price === '' ? 0 : (request.body?.price ?? 0))
  const entryCost = optionalMoney(request.body?.entryCost)
  const entrySalePrice = Number(price) > 0 ? Number(price) : null
  const initialStock = integer(request.body?.initialStock ?? 0, 'saldo inicial')

  const product = await withTransaction(async (client) => {
    try {
      const category = await client.query(
        'SELECT id FROM categories WHERE id=$1 AND active=TRUE FOR SHARE',
        [categoryId],
      )
      if (!category.rowCount)
        throw httpError(400, 'INVALID_CATEGORY', 'Selecione uma categoria ativa.')
      if (supplierId) {
        const supplier = await client.query(
          'SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR SHARE',
          [supplierId],
        )
        if (!supplier.rowCount)
          throw httpError(400, 'INVALID_SUPPLIER', 'Selecione um fornecedor ativo.')
      }
      if (initialStock > 0 && entryCost == null)
        throw httpError(
          400,
          'INITIAL_ENTRY_REQUIRED',
          'Informe o custo do saldo inicial. Fornecedor e preço de venda podem ser preenchidos depois.',
        )
      if (
        initialStock > 0 &&
        entrySalePrice != null &&
        Number(entrySalePrice) < Number((Number(entryCost) / unitsPerPurchase).toFixed(2))
      )
        throw httpError(
          409,
          'SALE_BELOW_COST',
          'O preço de venda não pode ficar abaixo do custo convertido por unidade de venda.',
        )
      const { rows } = await client.query(
        `INSERT INTO products (code, name, category_id, supplier_id, unit, purchase_unit, units_per_purchase, minimum, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [code, name, categoryId, supplierId, unit, purchaseUnit, unitsPerPurchase, minimum, price],
      )
      const id = rows[0].id
      if (supplierId)
        await client.query(
          'INSERT INTO product_suppliers (product_id, supplier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, supplierId],
        )
      await audit(client, request, 'cadastrou produto', 'produto', id, { code, name })
      if (initialStock > 0) {
        await recordLotMovement(client, {
          productId: id,
          userId: request.user.id,
          type: 'Entrada',
          quantity: initialStock,
          reason: 'Saldo inicial',
          openingBalance: true,
          supplierId,
          unitCost: Number(entryCost),
          unitSalePrice: entrySalePrice,
          occurredAt: movementTimestamp(request.body?.occurredAt),
          purchaseDetails: {
            quantity: initialStock,
            unit: purchaseUnit,
            conversion: unitsPerPurchase,
            unitCost: Number(entryCost),
          },
        })
      } else if (supplierId && entryCost != null) {
        await client.query(
          `INSERT INTO supplier_quotes (supplier_id, product_id, unit_price, quoted_at, note, created_by) VALUES ($1,$2,$3,CURRENT_DATE,'Preço informado no cadastro, sem entrada de estoque',$4)`,
          [
            supplierId,
            id,
            Number((Number(entryCost) / unitsPerPurchase).toFixed(2)),
            request.user.id,
          ],
        )
      }
      const result = await client.query(`${productSelect} WHERE p.id = $1`, [id])
      return { ...result.rows[0], price: Number(result.rows[0].price) }
    } catch (error) {
      if (error.code === '23505')
        throw httpError(409, 'DUPLICATE_PRODUCT_CODE', 'Já existe um produto com esse código.')
      if (error.code === '23503')
        throw httpError(
          400,
          'INVALID_REFERENCE',
          'Selecione uma categoria e um fornecedor válidos.',
        )
      throw error
    }
  })
  response.status(201).json(product)
})

app.patch('/api/products/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'produto')
  const code = requiredString(request.body?.code, 'código', 50).toUpperCase()
  const name = requiredString(request.body?.name, 'nome', 160)
  const categoryId = positiveId(request.body?.categoryId, 'categoria')
  const supplierId = request.body?.supplierId
    ? positiveId(request.body.supplierId, 'fornecedor')
    : null
  const unit = requiredString(request.body?.unit, 'unidade', 30)
  const purchaseUnitInput =
    request.body?.purchaseUnit == null
      ? null
      : requiredString(request.body.purchaseUnit, 'medida de compra', 30)
  const unitsPerPurchaseInput =
    request.body?.unitsPerPurchase == null
      ? null
      : integer(request.body.unitsPerPurchase, 'unidades por medida de compra', { minimum: 1 })
  const minimum = integer(request.body?.minimum ?? 0, 'estoque mínimo')
  const price = money(request.body?.price ?? 0)
  const declaredAverageCost = optionalMoney(request.body?.entryCost)
  const product = await withTransaction(async (client) => {
    try {
      const category = await client.query(
        'SELECT id FROM categories WHERE id=$1 AND active=TRUE FOR SHARE',
        [categoryId],
      )
      if (!category.rowCount)
        throw httpError(400, 'INVALID_CATEGORY', 'Selecione uma categoria ativa.')
      if (supplierId) {
        const supplier = await client.query(
          'SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR SHARE',
          [supplierId],
        )
        if (!supplier.rowCount)
          throw httpError(400, 'INVALID_SUPPLIER', 'Selecione um fornecedor ativo.')
      }
      const currentCost = await client.query(
        'SELECT stock, average_cost, unit, purchase_unit, units_per_purchase, EXISTS(SELECT 1 FROM movements WHERE product_id=$1) AS has_movements FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',
        [id],
      )
      if (!currentCost.rowCount)
        throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
      if (
        currentCost.rows[0].unit !== unit &&
        (Number(currentCost.rows[0].stock) > 0 || currentCost.rows[0].has_movements)
      )
        throw httpError(
          409,
          'SALE_UNIT_IN_USE',
          'A medida de venda não pode ser alterada depois de haver estoque ou movimentações.',
        )
      const purchaseUnit = purchaseUnitInput ?? currentCost.rows[0].purchase_unit
      const unitsPerPurchase =
        unitsPerPurchaseInput ?? Number(currentCost.rows[0].units_per_purchase)
      if (unit === purchaseUnit && unitsPerPurchase !== 1)
        throw httpError(
          400,
          'INVALID_UNIT_CONVERSION',
          'Use conversão 1 quando as medidas de compra e venda forem iguais.',
        )
      let reconciledCost = false
      if (declaredAverageCost != null) {
        const result = await client.query(
          "UPDATE inventory_lots SET unit_cost=$1 WHERE product_id=$2 AND source IN ('opening','adjustment') AND unit_cost IS NULL AND quantity_remaining>0",
          [declaredAverageCost, id],
        )
        reconciledCost = result.rowCount > 0
      }
      const averageCost = declaredAverageCost ?? currentCost.rows[0]?.average_cost
      if (Number(price) > 0 && Number(price) < Number(currentCost.rows[0].average_cost))
        throw httpError(
          409,
          'SALE_BELOW_COST',
          `O preço não pode ficar abaixo do custo médio de ${Number(currentCost.rows[0].average_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
        )
      const result = await client.query(
        `UPDATE products SET code=$1, name=$2, category_id=$3, supplier_id=$4, unit=$5, purchase_unit=$6, units_per_purchase=$7,
         minimum=$8, price=$9, average_cost=CASE WHEN $10::boolean THEN COALESCE((SELECT CASE WHEN BOOL_OR(quantity_remaining>0 AND unit_cost IS NULL) THEN NULL ELSE SUM(quantity_remaining*unit_cost)/NULLIF(SUM(quantity_remaining),0) END FROM inventory_lots WHERE product_id=$11),average_cost) ELSE average_cost END, updated_at=NOW() WHERE id=$11 AND active=TRUE RETURNING id`,
        [
          code,
          name,
          categoryId,
          supplierId,
          unit,
          purchaseUnit,
          unitsPerPurchase,
          minimum,
          price,
          reconciledCost,
          id,
        ],
      )
      if (!result.rowCount) throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
      if (Number(price) > 0) {
        await client.query(
          'UPDATE inventory_lots SET unit_sale_price=$1 WHERE product_id=$2 AND quantity_remaining>0 AND unit_sale_price IS NULL',
          [price, id],
        )
      }
      if (supplierId)
        await client.query(
          'INSERT INTO product_suppliers (product_id, supplier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, supplierId],
        )
      await audit(
        client,
        request,
        reconciledCost ? 'informou custo de abertura e atualizou produto' : 'atualizou produto',
        'produto',
        id,
        { code, name, openingUnitCost: reconciledCost ? declaredAverageCost : null },
      )
      const { rows } = await client.query(`${productSelect} WHERE p.id = $1`, [id])
      return { ...rows[0], price: Number(rows[0].price) }
    } catch (error) {
      if (error.code === '23505')
        throw httpError(409, 'DUPLICATE_PRODUCT_CODE', 'Já existe um produto com esse código.')
      if (error.code === '23503')
        throw httpError(
          400,
          'INVALID_REFERENCE',
          'Selecione uma categoria e um fornecedor válidos.',
        )
      throw error
    }
  })
  response.json(product)
})

app.delete('/api/products/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'produto')
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT stock FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',
      [id],
    )
    if (!rows[0]) throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    if (Number(rows[0].stock) !== 0)
      throw httpError(
        409,
        'PRODUCT_HAS_STOCK',
        'Registre uma movimentação para zerar o saldo antes de inativar o produto.',
      )
    await client.query('UPDATE products SET active=FALSE, updated_at=NOW() WHERE id=$1', [id])
    await audit(client, request, 'inativou produto', 'produto', id)
  })
  response.status(204).end()
})

app.patch('/api/products/:id/status', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'produto')
  if (typeof request.body?.active !== 'boolean')
    throw httpError(400, 'VALIDATION_ERROR', 'Informe se o produto deve ficar ativo ou inativo.')
  const product = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT active,stock FROM products WHERE id=$1 FOR UPDATE',
      [id],
    )
    if (!rows[0]) throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    if (!request.body.active && Number(rows[0].stock) !== 0)
      throw httpError(
        409,
        'PRODUCT_HAS_STOCK',
        'Registre uma movimentação para zerar o saldo antes de inativar o produto.',
      )
    const result = await client.query(
      'UPDATE products SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,active',
      [request.body.active, id],
    )
    await audit(
      client,
      request,
      request.body.active ? 'reativou produto' : 'inativou produto',
      'produto',
      id,
    )
    return result.rows[0]
  })
  response.json({ id: product.id, status: product.active ? 'Ativo' : 'Inativo' })
})

app.get('/api/categories', requireAuth, async (_request, response) => {
  const { rows } = await database.query(
    `SELECT c.id, c.name, c.description, COUNT(p.id)::int AS "productCount"
     FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=TRUE
     WHERE c.active=TRUE GROUP BY c.id ORDER BY c.name`,
  )
  response.json(rows)
})

app.post('/api/categories', requireAuth, requireAdmin, async (request, response) => {
  const name = requiredString(request.body?.name, 'nome', 100)
  const description = optionalString(request.body?.description, 'descrição')
  try {
    const category = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO categories (name, description) VALUES ($1,$2) RETURNING id,name,description',
        [name, description],
      )
      await audit(client, request, 'cadastrou categoria', 'categoria', rows[0].id, { name })
      return { ...rows[0], productCount: 0 }
    })
    response.status(201).json(category)
  } catch (error) {
    if (error.code === '23505')
      throw httpError(409, 'DUPLICATE_CATEGORY', 'Já existe uma categoria com esse nome.')
    throw error
  }
})

app.patch('/api/categories/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'categoria')
  const name = requiredString(request.body?.name, 'nome', 100)
  const description = optionalString(request.body?.description, 'descrição')
  try {
    const category = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'UPDATE categories SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 AND active=TRUE RETURNING id,name,description',
        [name, description, id],
      )
      if (!rows[0]) throw httpError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.')
      await audit(client, request, 'atualizou categoria', 'categoria', id, { name })
      const count = await client.query(
        'SELECT COUNT(*)::int AS count FROM products WHERE category_id=$1 AND active=TRUE',
        [id],
      )
      return { ...rows[0], productCount: count.rows[0].count }
    })
    response.json(category)
  } catch (error) {
    if (error.code === '23505')
      throw httpError(409, 'DUPLICATE_CATEGORY', 'Já existe uma categoria com esse nome.')
    throw error
  }
})

app.delete('/api/categories/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'categoria')
  await withTransaction(async (client) => {
    const category = await client.query(
      'SELECT id FROM categories WHERE id=$1 AND active=TRUE FOR UPDATE',
      [id],
    )
    if (!category.rowCount) throw httpError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.')
    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM products WHERE category_id=$1 AND active=TRUE',
      [id],
    )
    if (count.rows[0].count)
      throw httpError(409, 'CATEGORY_IN_USE', 'A categoria ainda está associada a produtos.')
    const { rowCount } = await client.query(
      'UPDATE categories SET active=FALSE, updated_at=NOW() WHERE id=$1 AND active=TRUE',
      [id],
    )
    if (!rowCount) throw httpError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.')
    await audit(client, request, 'inativou categoria', 'categoria', id)
  })
  response.status(204).end()
})

app.get('/api/suppliers', requireAuth, async (request, response) => {
  const includeInactive = request.query.status === 'all'
  if (includeInactive && request.user.role !== 'admin')
    throw httpError(403, 'FORBIDDEN', 'Esta ação exige perfil de administrador.')
  const { rows } = await database.query(
    `SELECT s.id, s.name, s.contact, s.email,
            CASE WHEN s.image_path IS NULL THEN NULL ELSE '/uploads/' || s.image_path END AS "imageUrl",
            s.active AS active,
            CASE WHEN s.active THEN 'Ativo' ELSE 'Inativo' END AS status,
            (SELECT COUNT(DISTINCT ps.product_id)::int FROM product_suppliers ps JOIN products p ON p.id=ps.product_id AND p.active=TRUE WHERE ps.supplier_id=s.id) AS products
     FROM suppliers s WHERE ($1::boolean OR s.active=TRUE) ORDER BY s.active DESC, s.name`,
    [includeInactive],
  )
  response.json(rows)
})

app.get('/api/suppliers/last-purchases', requireAuth, requireAdmin, async (_request, response) => {
  const { rows } = await database.query(
    `WITH purchases AS (
       SELECT DISTINCT ON (m.product_id,m.supplier_id) m.id,m.product_id,m.supplier_id,m.quantity,m.occurred_at,m.unit_cost
       FROM movements m WHERE m.type='Entrada' AND m.supplier_id IS NOT NULL AND m.voided_at IS NULL
       ORDER BY m.product_id,m.supplier_id,m.occurred_at DESC,m.id DESC
     ), quotes AS (
       SELECT DISTINCT ON (q.product_id,q.supplier_id) q.product_id,q.supplier_id,q.unit_price,q.quoted_at
       FROM supplier_quotes q ORDER BY q.product_id,q.supplier_id,q.quoted_at DESC,q.id DESC
     ), cheapest AS (
       SELECT DISTINCT ON (pch.product_id) pch.product_id,pch.unit_cost
       FROM purchases pch WHERE pch.unit_cost IS NOT NULL
       ORDER BY pch.product_id,pch.unit_cost,pch.occurred_at DESC
     )
     SELECT pch.id,pch.product_id AS "productId",p.name AS "productName",p.code AS "productCode",p.unit,
            pch.supplier_id AS "supplierId",s.name AS supplier,s.active AS "supplierActive",pch.quantity,
            pch.occurred_at AS date,pch.unit_cost AS "unitCost",q.unit_price AS "lastQuotePrice",q.quoted_at AS "lastQuoteDate",
            (pch.unit_cost=ch.unit_cost) AS "isLowestPurchaseCost"
     FROM purchases pch JOIN products p ON p.id=pch.product_id AND p.active=TRUE
     JOIN suppliers s ON s.id=pch.supplier_id LEFT JOIN quotes q ON q.product_id=pch.product_id AND q.supplier_id=pch.supplier_id
     LEFT JOIN cheapest ch ON ch.product_id=pch.product_id ORDER BY p.name,pch.unit_cost`,
  )
  response.json(rows)
})

app.get('/api/suppliers/:id/products', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const { rows } = await database.query(
    `SELECT p.id, p.code, p.name, p.category_id AS "categoryId", c.name AS category,
            p.unit, p.stock, p.minimum, p.price
     FROM product_suppliers ps JOIN products p ON p.id=ps.product_id
     JOIN categories c ON c.id=p.category_id
     WHERE ps.supplier_id=$1 AND p.active=TRUE ORDER BY p.name`,
    [supplierId],
  )
  response.json(rows.map((row) => ({ ...row, price: Number(row.price) })))
})

app.get('/api/suppliers/:id/comparisons', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const { rows } = await database.query(
    `WITH latest_purchases AS (
       SELECT DISTINCT ON (m.product_id, m.supplier_id)
              m.product_id, m.supplier_id, m.quantity, m.unit_cost, m.occurred_at
       FROM movements m
       WHERE m.type='Entrada' AND m.unit_cost IS NOT NULL AND m.voided_at IS NULL
       ORDER BY m.product_id, m.supplier_id, m.occurred_at DESC, m.id DESC
     ), latest_quotes AS (
       SELECT DISTINCT ON (q.product_id, q.supplier_id)
              q.product_id, q.supplier_id, q.unit_price, q.quoted_at
       FROM supplier_quotes q
       ORDER BY q.product_id, q.supplier_id, q.quoted_at DESC, q.id DESC
     )
     SELECT p.id AS "productId", p.name AS "productName", p.code AS "productCode", p.unit,
            s.id AS "supplierId", s.name AS supplier, s.active AS "supplierActive",
            lp.quantity AS "lastPurchaseQuantity", lp.unit_cost AS "lastPurchaseCost", lp.occurred_at AS "lastPurchaseDate",
            lq.unit_price AS "lastQuotePrice", lq.quoted_at AS "lastQuoteDate"
     FROM product_suppliers selected
     JOIN products p ON p.id=selected.product_id AND p.active=TRUE
     JOIN product_suppliers competing ON competing.product_id=p.id
     JOIN suppliers s ON s.id=competing.supplier_id
     LEFT JOIN latest_purchases lp ON lp.product_id=p.id AND lp.supplier_id=s.id
     LEFT JOIN latest_quotes lq ON lq.product_id=p.id AND lq.supplier_id=s.id
     WHERE selected.supplier_id=$1
     ORDER BY p.name, s.active DESC, s.name`,
    [supplierId],
  )
  response.json(
    rows.map((row) => ({
      ...row,
      lastPurchaseCost: row.lastPurchaseCost == null ? null : Number(row.lastPurchaseCost),
      lastQuotePrice: row.lastQuotePrice == null ? null : Number(row.lastQuotePrice),
    })),
  )
})

app.post('/api/suppliers/:id/products', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const productId = positiveId(request.body?.productId, 'produto')
  await withTransaction(async (client) => {
    const [supplier, product] = await Promise.all([
      client.query('SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR SHARE', [supplierId]),
      client.query('SELECT id FROM products WHERE id=$1 AND active=TRUE FOR SHARE', [productId]),
    ])
    if (!supplier.rowCount)
      throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado ou inativo.')
    if (!product.rowCount)
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo.')
    const result = await client.query(
      'INSERT INTO product_suppliers (product_id, supplier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [productId, supplierId],
    )
    if (result.rowCount)
      await audit(client, request, 'vinculou produto a fornecedor', 'fornecedor', supplierId, {
        productId,
      })
  })
  response.status(201).json({ supplierId, productId })
})

app.delete(
  '/api/suppliers/:id/products/:productId',
  requireAuth,
  requireAdmin,
  async (request, response) => {
    const supplierId = positiveId(request.params.id, 'fornecedor')
    const productId = positiveId(request.params.productId, 'produto')
    await withTransaction(async (client) => {
      const [supplier, product] = await Promise.all([
        client.query('SELECT id FROM suppliers WHERE id=$1 FOR SHARE', [supplierId]),
        client.query('SELECT id FROM products WHERE id=$1 FOR SHARE', [productId]),
      ])
      if (!supplier.rowCount)
        throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.')
      if (!product.rowCount) throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')

      const result = await client.query(
        'DELETE FROM product_suppliers WHERE product_id=$1 AND supplier_id=$2',
        [productId, supplierId],
      )
      const legacyLink = await client.query(
        'UPDATE products SET supplier_id=NULL, updated_at=NOW() WHERE id=$1 AND supplier_id=$2',
        [productId, supplierId],
      )
      if (result.rowCount || legacyLink.rowCount) {
        await audit(
          client,
          request,
          'desvinculou produto de fornecedor',
          'fornecedor',
          supplierId,
          { productId },
        )
      }
    })
    response.status(204).end()
  },
)

app.patch('/api/suppliers/:id/status', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const active = request.body?.active
  if (typeof active !== 'boolean')
    throw httpError(400, 'VALIDATION_ERROR', 'Informe se o fornecedor deve ficar ativo ou inativo.')
  const supplier = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE suppliers SET active=$1, updated_at=NOW() WHERE id=$2
       RETURNING id, name, contact, email, image_path, active`,
      [active, supplierId],
    )
    if (!rows[0]) throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.')
    await audit(
      client,
      request,
      active ? 'reativou fornecedor' : 'inativou fornecedor',
      'fornecedor',
      supplierId,
    )
    return rows[0]
  })
  response.json({
    id: supplier.id,
    name: supplier.name,
    status: supplier.active ? 'Ativo' : 'Inativo',
  })
})

app.get('/api/suppliers/:id/entries', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '20', 10) || 20))
  const offset = (page - 1) * limit
  const [count, result] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total FROM movements WHERE supplier_id=$1 AND type='Entrada'`,
      [supplierId],
    ),
    database.query(
      `SELECT m.id, m.product_id AS "productId", p.name AS "productName", p.code AS "productCode", p.unit,
            m.quantity, COALESCE(m.purchase_quantity,m.quantity) AS "purchaseQuantity", COALESCE(m.purchase_unit,p.unit) AS "purchaseUnit",
            COALESCE(m.purchase_conversion,1) AS "purchaseConversion", COALESCE(m.purchase_unit_cost,m.unit_cost) AS "purchaseUnitCost",
            m.occurred_at AS date, m.unit_cost AS "unitCost", m.unit_sale_price AS "unitSalePrice",m.voided_at AS "voidedAt",m.void_reason AS "voidReason",l.quantity_remaining AS "quantityRemaining",
            m.quantity * m.unit_cost AS "totalCost"
     FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN inventory_lots l ON l.movement_id=m.id
     WHERE m.supplier_id=$1 AND m.type='Entrada'
     ORDER BY m.occurred_at DESC, m.id DESC LIMIT $2 OFFSET $3`,
      [supplierId, limit, offset],
    ),
  ])
  response.json({ page, limit, total: count.rows[0].total, entries: result.rows })
})

app.get('/api/suppliers/options', requireAuth, async (_request, response) => {
  const { rows } = await database.query(
    'SELECT id, name FROM suppliers WHERE active=TRUE ORDER BY name',
  )
  response.json(rows)
})

app.get('/api/suppliers/:id/quotes', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '20', 10) || 20))
  const offset = (page - 1) * limit
  const [count, result] = await Promise.all([
    database.query('SELECT COUNT(*)::int AS total FROM supplier_quotes WHERE supplier_id=$1', [
      supplierId,
    ]),
    database.query(
      `SELECT q.id, q.product_id AS "productId", p.name AS "productName", p.code AS "productCode",
            p.unit, q.unit_price AS "unitPrice", q.quoted_at AS "quotedAt", q.note
     FROM supplier_quotes q JOIN products p ON p.id=q.product_id
     WHERE q.supplier_id=$1 ORDER BY q.quoted_at DESC, q.id DESC LIMIT $2 OFFSET $3`,
      [supplierId, limit, offset],
    ),
  ])
  response.json({
    page,
    limit,
    total: count.rows[0].total,
    quotes: result.rows.map((row) => ({ ...row, unitPrice: Number(row.unitPrice) })),
  })
})

app.post('/api/suppliers/:id/quotes', requireAuth, requireAdmin, async (request, response) => {
  const supplierId = positiveId(request.params.id, 'fornecedor')
  const productId = positiveId(request.body?.productId, 'produto')
  const unitPrice = money(request.body?.unitPrice)
  if (Number(unitPrice) <= 0)
    throw httpError(400, 'VALIDATION_ERROR', 'O preço informado deve ser maior que zero.')
  const quotedAt = request.body?.quotedAt ?? new Date().toISOString().slice(0, 10)
  const parsedQuoteDate =
    typeof quotedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(quotedAt)
      ? new Date(`${quotedAt}T00:00:00.000Z`)
      : null
  if (
    !parsedQuoteDate ||
    Number.isNaN(parsedQuoteDate.getTime()) ||
    parsedQuoteDate.toISOString().slice(0, 10) !== quotedAt
  ) {
    throw httpError(400, 'VALIDATION_ERROR', 'Informe uma data válida para a cotação.')
  }
  const note = optionalString(request.body?.note, 'observação')
  const quote = await withTransaction(async (client) => {
    const [supplier, product] = await Promise.all([
      client.query('SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR SHARE', [supplierId]),
      client.query('SELECT id FROM products WHERE id=$1 AND active=TRUE FOR SHARE', [productId]),
    ])
    if (!supplier.rowCount)
      throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado ou inativo.')
    if (!product.rowCount)
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo.')
    const { rows } = await client.query(
      `INSERT INTO supplier_quotes (supplier_id, product_id, unit_price, quoted_at, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, product_id AS "productId", unit_price AS "unitPrice", quoted_at AS "quotedAt", note`,
      [supplierId, productId, unitPrice, quotedAt, note, request.user.id],
    )
    await client.query(
      'INSERT INTO product_suppliers (product_id, supplier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [productId, supplierId],
    )
    await audit(client, request, 'registrou cotação', 'fornecedor', supplierId, {
      productId,
      unitPrice,
      quotedAt,
    })
    return { ...rows[0], unitPrice: Number(rows[0].unitPrice) }
  })
  response.status(201).json(quote)
})

app.put('/api/suppliers/:id/image', requireAuth, requireAdmin, rawImage, uploadImage('suppliers'))

app.post('/api/suppliers', requireAuth, requireAdmin, async (request, response) => {
  const name = requiredString(request.body?.name, 'nome', 160)
  const contact = optionalString(request.body?.contact, 'telefone', 80)
  const email = optionalEmail(request.body?.email)
  try {
    const supplier = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO suppliers (name, contact, email) VALUES ($1,$2,$3) RETURNING id,name,contact,email',
        [name, contact, email],
      )
      await audit(client, request, 'cadastrou fornecedor', 'fornecedor', rows[0].id, { name })
      return { ...rows[0], imageUrl: null, products: 0 }
    })
    response.status(201).json(supplier)
  } catch (error) {
    if (error.code === '23505')
      throw httpError(409, 'DUPLICATE_SUPPLIER', 'Já existe um fornecedor com esse nome.')
    throw error
  }
})

app.patch('/api/suppliers/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'fornecedor')
  const name = requiredString(request.body?.name, 'nome', 160)
  const contact = optionalString(request.body?.contact, 'telefone', 80)
  const email = optionalEmail(request.body?.email)
  try {
    const supplier = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'UPDATE suppliers SET name=$1, contact=$2, email=$3, updated_at=NOW() WHERE id=$4 AND active=TRUE RETURNING id,name,contact,email,image_path',
        [name, contact, email, id],
      )
      if (!rows[0]) throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.')
      await audit(client, request, 'atualizou fornecedor', 'fornecedor', id, { name })
      const linkedProducts = await client.query(
        `SELECT COUNT(*)::int AS count FROM (
          SELECT p.id FROM products p WHERE p.supplier_id=$1 AND p.active=TRUE
          UNION SELECT q.product_id FROM supplier_quotes q JOIN products p ON p.id=q.product_id AND p.active=TRUE WHERE q.supplier_id=$1
          UNION SELECT m.product_id FROM movements m JOIN products p ON p.id=m.product_id AND p.active=TRUE WHERE m.supplier_id=$1 AND m.type='Entrada'
        ) linked`,
        [id],
      )
      const { image_path: imagePath, ...supplierData } = rows[0]
      return {
        ...supplierData,
        imageUrl: imagePath ? `/uploads/${imagePath}` : null,
        products: linkedProducts.rows[0].count,
      }
    })
    response.json(supplier)
  } catch (error) {
    if (error.code === '23505')
      throw httpError(409, 'DUPLICATE_SUPPLIER', 'Já existe um fornecedor com esse nome.')
    throw error
  }
})

app.delete('/api/suppliers/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'fornecedor')
  await withTransaction(async (client) => {
    const supplier = await client.query(
      'SELECT id FROM suppliers WHERE id=$1 AND active=TRUE FOR UPDATE',
      [id],
    )
    if (!supplier.rowCount) throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.')
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM (
        SELECT id FROM products WHERE supplier_id=$1 AND active=TRUE
        UNION SELECT m.product_id AS id FROM movements m JOIN products p ON p.id=m.product_id AND p.active=TRUE WHERE m.supplier_id=$1 AND m.type='Entrada'
      ) linked`,
      [id],
    )
    if (count.rows[0].count)
      throw httpError(409, 'SUPPLIER_IN_USE', 'O fornecedor ainda está associado a produtos.')
    const { rowCount } = await client.query(
      'UPDATE suppliers SET active=FALSE, updated_at=NOW() WHERE id=$1 AND active=TRUE',
      [id],
    )
    if (!rowCount) throw httpError(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.')
    await audit(client, request, 'inativou fornecedor', 'fornecedor', id)
  })
  response.status(204).end()
})

app.get('/api/users', requireAuth, requireAdmin, async (_request, response) => {
  const { rows } = await database.query(
    'SELECT id,name,username,email,role,active FROM users ORDER BY name',
  )
  response.json(rows.map(publicUser))
})

app.post('/api/users', requireAuth, requireAdmin, async (request, response) => {
  const name = requiredString(request.body?.name, 'nome', 120)
  const username = requiredString(request.body?.username, 'usuário', 50).toLowerCase()
  if (!/^[a-z0-9._-]{3,50}$/.test(username))
    throw httpError(
      400,
      'INVALID_USERNAME',
      'O usuário deve ter de 3 a 50 letras, números, pontos, hífens ou sublinhados.',
    )
  const email = requiredString(request.body?.email, 'e-mail', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw httpError(400, 'INVALID_EMAIL', 'Informe um e-mail válido.')
  const password = request.body?.password
  if (typeof password !== 'string' || !password)
    throw httpError(400, 'VALIDATION_ERROR', 'Informe uma senha inicial.')
  const role = request.body?.role
  if (!['admin', 'operator'].includes(role))
    throw httpError(400, 'VALIDATION_ERROR', 'Selecione um perfil válido.')
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)
    throw httpError(400, 'WEAK_PASSWORD', 'A senha deve ter entre 12 e 72 bytes.')
  try {
    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO users (name,username,email,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,$5,FALSE) RETURNING id,name,username,email,role,active',
        [name, username, email, await hashPassword(password), role],
      )
      await audit(client, request, 'cadastrou usuário', 'usuário', rows[0].id, {
        username,
        email,
        role,
      })
      return publicUser(rows[0])
    })
    response.status(201).json(user)
  } catch (error) {
    if (error.code === '23505')
      throw httpError(409, 'DUPLICATE_USER', 'Já existe uma conta com esse usuário ou e-mail.')
    throw error
  }
})

app.patch('/api/users/:id', requireAuth, requireAdmin, async (request, response) => {
  const id = positiveId(request.params.id, 'usuário')
  const role = request.body?.role
  const active = request.body?.active
  if (!['admin', 'operator'].includes(role) || typeof active !== 'boolean') {
    throw httpError(400, 'VALIDATION_ERROR', 'Perfil e status do usuário são obrigatórios.')
  }
  if (id === request.user.id && (!active || role !== request.user.role)) {
    throw httpError(
      400,
      'SELF_CHANGE_NOT_ALLOWED',
      'Não é permitido desativar ou alterar o próprio perfil.',
    )
  }
  const user = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(614392817)')
    const current = await client.query('SELECT role, active FROM users WHERE id=$1', [id])
    if (!current.rowCount) throw httpError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.')
    if (
      current.rows[0].role === 'admin' &&
      current.rows[0].active &&
      (role !== 'admin' || !active)
    ) {
      const admins = await client.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role='admin' AND active=TRUE",
      )
      if (admins.rows[0].count < 2)
        throw httpError(
          409,
          'LAST_ADMIN',
          'O sistema precisa manter pelo menos um administrador ativo.',
        )
    }
    const { rows } = await client.query(
      `UPDATE users SET role=$1, active=$2,
       session_version=session_version + CASE WHEN active AND NOT $2 THEN 1 ELSE 0 END,
       updated_at=NOW() WHERE id=$3 RETURNING id,name,username,email,role,active`,
      [role, active, id],
    )
    await audit(
      client,
      request,
      active ? 'atualizou permissões' : 'inativou usuário',
      'usuário',
      id,
      { role, active },
    )
    return publicUser(rows[0])
  })
  response.json(user)
})

app.get('/api/movements', requireAuth, async (request, response) => {
  const from = request.query.from ? new Date(request.query.from) : null
  const to = request.query.to ? new Date(request.query.to) : null
  if (from && Number.isNaN(from.valueOf()))
    throw httpError(400, 'INVALID_DATE', 'Data inicial inválida.')
  if (to && Number.isNaN(to.valueOf())) throw httpError(400, 'INVALID_DATE', 'Data final inválida.')
  const { rows } = await database.query(
    `SELECT m.id, m.product_id AS "productId", m.type, m.quantity, p.unit,
            COALESCE(m.purchase_quantity,m.quantity) AS "purchaseQuantity", COALESCE(m.purchase_unit,p.unit) AS "purchaseUnit",
            COALESCE(m.purchase_conversion,1) AS "purchaseConversion", COALESCE(m.purchase_unit_cost,m.unit_cost) AS "purchaseUnitCost",
            m.reason, u.name AS "user", m.occurred_at AS date,
            m.supplier_id AS "supplierId",m.unit_cost AS "unitCost",m.unit_sale_price AS "unitSalePrice",
            COALESCE((SELECT SUM(a.quantity*a.unit_cost) FROM movement_lot_allocations a WHERE a.movement_id=m.id),0) AS "fifoCost",
            CASE WHEN m.quantity<0 THEN -m.quantity*m.unit_sale_price ELSE NULL END AS revenue,m.voided_at AS "voidedAt",m.void_reason AS "voidReason"
     FROM movements m JOIN users u ON u.id=m.user_id JOIN products p ON p.id=m.product_id
     WHERE ($1::timestamptz IS NULL OR m.occurred_at >= $1)
       AND ($2::timestamptz IS NULL OR m.occurred_at < $2 + INTERVAL '1 day')
     ORDER BY m.occurred_at DESC LIMIT 1000`,
    [from, to],
  )
  response.json(rows)
})

// Consulta paginada; /movements mantém o contrato anterior.
app.get('/api/movements/search', requireAuth, async (request, response) => {
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '25', 10) || 25))
  const offset = (page - 1) * limit
  const search = optionalString(request.query.search, 'busca', 160)
  const productId = request.query.productId ? positiveId(request.query.productId, 'produto') : null
  const supplierId = request.query.supplierId
    ? positiveId(request.query.supplierId, 'fornecedor')
    : null
  const type = request.query.type || null
  if (type && !['Entrada', 'Saída', 'Ajuste'].includes(type))
    throw httpError(400, 'INVALID_MOVEMENT_TYPE', 'Selecione um tipo de movimentação válido.')
  const fromDate = request.query.from || null
  const toDate = request.query.to || null
  const isDate = (value) =>
    !value ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
  if (!isDate(fromDate) || !isDate(toDate) || (fromDate && toDate && fromDate > toDate))
    throw httpError(400, 'INVALID_PERIOD', 'Informe um período válido para as movimentações.')
  const values = [search ? `%${search}%` : null, productId, supplierId, type, fromDate, toDate]
  const where = `($1::text IS NULL OR p.name ILIKE $1 OR p.code ILIKE $1 OR u.name ILIKE $1 OR m.reason ILIKE $1 OR COALESCE(s.name,'') ILIKE $1)
    AND ($2::int IS NULL OR m.product_id=$2)
    AND ($3::int IS NULL OR m.supplier_id=$3 OR EXISTS(SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$3))
    AND ($4::text IS NULL OR m.type=$4)
    AND ($5::date IS NULL OR m.occurred_at >= ($5::date::timestamp AT TIME ZONE 'America/Fortaleza'))
    AND ($6::date IS NULL OR m.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'America/Fortaleza'))`
  const [count, result] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id LEFT JOIN suppliers s ON s.id=m.supplier_id WHERE ${where}`,
      values,
    ),
    database.query(
      `SELECT m.id,m.product_id AS "productId",m.type,m.quantity,p.unit,
              COALESCE(m.purchase_quantity,m.quantity) AS "purchaseQuantity",COALESCE(m.purchase_unit,p.unit) AS "purchaseUnit",
              COALESCE(m.purchase_conversion,1) AS "purchaseConversion",COALESCE(m.purchase_unit_cost,m.unit_cost) AS "purchaseUnitCost",
              m.reason,u.name AS "user",m.occurred_at AS date,m.supplier_id AS "supplierId",s.name AS supplier,m.unit_cost AS "unitCost",
              m.unit_sale_price AS "unitSalePrice",COALESCE((SELECT SUM(a.quantity*a.unit_cost) FROM movement_lot_allocations a WHERE a.movement_id=m.id),0) AS "fifoCost",
              CASE WHEN m.quantity<0 THEN -m.quantity*m.unit_sale_price ELSE NULL END AS revenue,m.voided_at AS "voidedAt",m.void_reason AS "voidReason"
       FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id LEFT JOIN suppliers s ON s.id=m.supplier_id
       WHERE ${where} ORDER BY m.occurred_at DESC,m.id DESC LIMIT $7 OFFSET $8`,
      [...values, limit, offset],
    ),
  ])
  response.json({ page, limit, total: count.rows[0].total, movements: result.rows })
})

app.post('/api/movements', requireAuth, async (request, response) => {
  const productId = positiveId(request.body?.productId, 'produto')
  const type = request.body?.type
  if (!['Entrada', 'Saída', 'Ajuste'].includes(type))
    throw httpError(400, 'VALIDATION_ERROR', 'Selecione um tipo de movimentação válido.')
  const quantity = integer(
    type === 'Ajuste' ? request.body?.adjustment : request.body?.quantity,
    'quantidade',
    { allowNegative: type === 'Ajuste' },
  )
  const signedQuantity = type === 'Saída' ? -quantity : quantity
  if (type === 'Entrada' && quantity <= 0)
    throw httpError(400, 'VALIDATION_ERROR', 'A entrada precisa ser maior que zero.')
  if (type === 'Saída' && quantity <= 0)
    throw httpError(400, 'VALIDATION_ERROR', 'A saída precisa ser maior que zero.')
  const reason = optionalString(request.body?.reason, 'observação') || 'Sem observação'
  const supplierId =
    type === 'Entrada' && request.body?.supplierId
      ? positiveId(request.body.supplierId, 'fornecedor')
      : null
  const unitCost =
    type === 'Entrada' || (type === 'Ajuste' && signedQuantity > 0)
      ? optionalMoney(request.body?.unitCost)
      : null
  const unitSalePrice = type !== 'Ajuste' ? optionalMoney(request.body?.unitSalePrice) : null
  if (
    type === 'Entrada' &&
    (!supplierId || unitCost == null || unitSalePrice == null || Number(unitSalePrice) <= 0)
  )
    throw httpError(
      400,
      'ENTRY_VALUES_REQUIRED',
      'Informe fornecedor, custo de entrada e preço de venda para registrar a compra.',
    )
  if (supplierId) {
    const supplier = await database.query('SELECT id FROM suppliers WHERE id=$1 AND active=TRUE', [
      supplierId,
    ])
    if (!supplier.rowCount)
      throw httpError(400, 'INVALID_SUPPLIER', 'Selecione um fornecedor ativo.')
  }
  const occurredAt = movementTimestamp(request.body?.occurredAt)
  const movement = await withTransaction((client) =>
    recordLotMovement(client, {
      productId,
      userId: request.user.id,
      type,
      quantity: signedQuantity,
      reason,
      supplierId,
      unitCost,
      unitSalePrice,
      occurredAt,
    }),
  )
  response.status(201).json(movement)
})

app.patch('/api/movements/:id', requireAuth, requireAdmin, async (request, response) => {
  const movementId = positiveId(request.params.id, 'movimenta\u00e7\u00e3o')
  const reason = requiredString(request.body?.reason, 'motivo da corre\u00e7\u00e3o', 500)
  const quantity = integer(request.body?.quantity, 'quantidade', { minimum: 1 })
  const supplierId = positiveId(request.body?.supplierId, 'fornecedor')
  const unitCost = money(request.body?.unitCost)
  const sale = money(request.body?.unitSalePrice)
  if (Number(sale) <= 0)
    throw httpError(400, 'VALIDATION_ERROR', 'O pre\u00e7o de venda precisa ser maior que zero.')
  const occurredAt = movementTimestamp(request.body?.occurredAt)
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM movements WHERE id=$1 AND type=$2 AND voided_at IS NULL FOR UPDATE',
      [movementId, 'Entrada'],
    )
    const entry = rows[0]
    if (!entry)
      throw httpError(404, 'PURCHASE_NOT_FOUND', 'Compra n\u00e3o encontrada ou j\u00e1 estornada.')
    const product = (
      await client.query(
        'SELECT stock,unit,purchase_unit,units_per_purchase FROM products WHERE id=$1 FOR UPDATE',
        [entry.product_id],
      )
    ).rows[0]
    const conversion = Number(entry.purchase_conversion ?? product.units_per_purchase ?? 1)
    const stockQuantity = quantity * conversion
    if (!Number.isSafeInteger(stockQuantity) || stockQuantity > 2147483647)
      throw httpError(400, 'VALIDATION_ERROR', 'A quantidade convertida excede o limite permitido.')
    const baseCost = Number((Number(unitCost) / conversion).toFixed(2))
    const targetStock = Number(product.stock) + stockQuantity - Number(entry.quantity)
    await client.query(
      'UPDATE movements SET quantity=$1,supplier_id=$2,unit_cost=$3,unit_sale_price=$4,occurred_at=$5,reason=$6,purchase_quantity=$7,purchase_unit=$8,purchase_conversion=$9,purchase_unit_cost=$10 WHERE id=$11',
      [
        stockQuantity,
        supplierId,
        baseCost,
        sale,
        occurredAt,
        `Corre\u00e7\u00e3o: ${reason}`,
        quantity,
        entry.purchase_unit ?? product.purchase_unit ?? product.unit,
        conversion,
        Number(unitCost),
        movementId,
      ],
    )
    await client.query(
      'INSERT INTO product_suppliers(product_id,supplier_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [entry.product_id, supplierId],
    )
    await rebuildProductLots(client, entry.product_id, targetStock)
    await audit(client, request, 'corrigiu compra', 'movimenta\u00e7\u00e3o', movementId, {
      reason,
      old: {
        quantity: entry.quantity,
        supplierId: entry.supplier_id,
        unitCost: entry.unit_cost,
        unitSalePrice: entry.unit_sale_price,
        occurredAt: entry.occurred_at,
      },
      new: { quantity, supplierId, unitCost, salePrice: sale, occurredAt },
    })
    return {
      id: movementId,
      productId: entry.product_id,
      quantity: stockQuantity,
      purchaseQuantity: quantity,
      purchaseUnit: entry.purchase_unit ?? product.purchase_unit ?? product.unit,
      supplierId,
      unitCost: baseCost,
      purchaseUnitCost: Number(unitCost),
      unitSalePrice: Number(sale),
      date: occurredAt,
    }
  })
  response.json(result)
})

app.post('/api/movements/:id/reverse', requireAuth, requireAdmin, async (request, response) => {
  const movementId = positiveId(request.params.id, 'movimenta\u00e7\u00e3o')
  const reason = requiredString(request.body?.reason, 'motivo do estorno', 500)
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM movements WHERE id=$1 AND type=$2 AND voided_at IS NULL FOR UPDATE',
      [movementId, 'Entrada'],
    )
    const entry = rows[0]
    if (!entry)
      throw httpError(404, 'PURCHASE_NOT_FOUND', 'Compra n\u00e3o encontrada ou j\u00e1 estornada.')
    const current = await client.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE', [
      entry.product_id,
    ])
    const targetStock = Number(current.rows[0].stock) - Number(entry.quantity)
    await client.query(
      'UPDATE movements SET voided_at=NOW(),voided_by=$1,void_reason=$2 WHERE id=$3',
      [request.user.id, reason, movementId],
    )
    await rebuildProductLots(client, entry.product_id, targetStock)
    await audit(client, request, 'estornou compra', 'movimenta\u00e7\u00e3o', movementId, {
      reason,
      quantity: entry.quantity,
      supplierId: entry.supplier_id,
    })
  })
  response.status(204).end()
})

app.patch(
  '/api/products/:id/opening-cost',
  requireAuth,
  requireAdmin,
  async (request, response) => {
    const id = positiveId(request.params.id, 'produto')
    const unitCost = money(request.body?.unitCost)
    const reason = requiredString(request.body?.reason, 'motivo do custo de abertura', 500)
    const result = await withTransaction(async (client) => {
      const product = await client.query(
        'SELECT stock FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',
        [id],
      )
      if (!product.rowCount)
        throw httpError(404, 'PRODUCT_NOT_FOUND', 'Produto n\u00e3o encontrado ou inativo.')
      const updated = await client.query(
        'UPDATE inventory_lots SET unit_cost=$1 WHERE product_id=$2 AND quantity_remaining>0 AND unit_cost IS NULL RETURNING id,movement_id,quantity_remaining',
        [unitCost, id],
      )
      if (!updated.rowCount)
        throw httpError(
          409,
          'NO_PENDING_OPENING_COST',
          'Este produto n\u00e3o possui saldo pendente de custo.',
        )
      const movementIds = updated.rows
        .map((lot) => lot.movement_id)
        .filter((movementId) => movementId != null)
      if (movementIds.length)
        await client.query(
          "UPDATE movements m SET unit_cost=$1::numeric, purchase_unit_cost=CASE WHEN m.type='Entrada' THEN COALESCE(m.purchase_unit_cost,$1::numeric*COALESCE(m.purchase_conversion,p.units_per_purchase,1)) ELSE m.purchase_unit_cost END, purchase_quantity=CASE WHEN m.type='Entrada' THEN COALESCE(m.purchase_quantity,ROUND(m.quantity::numeric/COALESCE(m.purchase_conversion,p.units_per_purchase,1))::int) ELSE m.purchase_quantity END, purchase_unit=CASE WHEN m.type='Entrada' THEN COALESCE(m.purchase_unit,p.purchase_unit,p.unit) ELSE m.purchase_unit END, purchase_conversion=CASE WHEN m.type='Entrada' THEN COALESCE(m.purchase_conversion,p.units_per_purchase,1) ELSE m.purchase_conversion END FROM products p WHERE m.product_id=p.id AND m.id=ANY($2::bigint[])",
          [unitCost, movementIds],
        )
      const average = await client.query(
        'SELECT CASE WHEN BOOL_OR(quantity_remaining>0 AND unit_cost IS NULL) THEN NULL ELSE SUM(quantity_remaining*unit_cost)/NULLIF(SUM(quantity_remaining),0) END AS average FROM inventory_lots WHERE product_id=$1 AND quantity_remaining>0',
        [id],
      )
      await client.query('UPDATE products SET average_cost=$1,updated_at=NOW() WHERE id=$2', [
        average.rows[0].average,
        id,
      ])
      const unitsAssigned = updated.rows.reduce(
        (sum, lot) => sum + Number(lot.quantity_remaining),
        0,
      )
      await audit(client, request, 'informou custo de saldo pendente', 'produto', id, {
        unitCost: Number(unitCost),
        reason,
        lotCount: updated.rowCount,
        unitsAssigned,
        movementCount: movementIds.length,
      })
      return { unitsAssigned, lotCount: updated.rowCount }
    })
    response.json({ ok: true, ...result })
  },
)

app.get('/api/reports', requireAuth, requireAdmin, async (request, response) => {
  const { period, fromDate, toDate, interval } = reportPeriod(request.query)
  if (request.query.compare && request.query.compare !== 'previous')
    throw httpError(400, 'INVALID_COMPARISON', 'Selecione um tipo válido de comparação.')
  const productId = request.query.productId ? positiveId(request.query.productId, 'produto') : null
  const supplierId = request.query.supplierId
    ? positiveId(request.query.supplierId, 'fornecedor')
    : null
  const exitType = 'Sa\u00edda'
  const args = [fromDate, toDate, interval, productId, supplierId]
  const dateFilter = `(($1::date IS NOT NULL AND m.occurred_at >= ($1::date::timestamp AT TIME ZONE 'America/Fortaleza')) OR ($1::date IS NULL AND m.occurred_at >= NOW()-$3::interval)) AND ($2::date IS NULL OR m.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Fortaleza'))`
  const { rows: summary } = await database.query(
    `WITH pm AS (
       SELECT m.* FROM movements m WHERE m.voided_at IS NULL AND ${dateFilter}
         AND ($4::int IS NULL OR m.product_id=$4)
         AND ($5::int IS NULL OR m.supplier_id=$5 OR EXISTS (SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$5))
     ), p AS (SELECT COALESCE(SUM(quantity*unit_cost),0) cost,COALESCE(SUM(quantity),0)::int units,COALESCE(SUM(quantity*unit_sale_price),0) sale,COALESCE(SUM(quantity*(unit_sale_price-unit_cost)),0) margin FROM pm WHERE type='Entrada'),
     sale_rows AS (SELECT m.id,m.product_id,m.unit_sale_price,SUM(a.quantity)::int AS units,SUM(a.quantity*a.unit_cost) AS cogs FROM pm m JOIN movement_lot_allocations a ON a.movement_id=m.id JOIN inventory_lots l ON l.id=a.lot_id WHERE m.type=$6 AND ($5::int IS NULL OR l.supplier_id=$5) GROUP BY m.id,m.product_id,m.unit_sale_price),
     s AS (SELECT COALESCE(SUM(units*unit_sale_price),0) revenue,COALESCE(SUM(cogs),0) cogs,COUNT(*)::int exits,COALESCE(SUM(units),0)::int units FROM sale_rows),
     i AS (SELECT COALESCE(SUM(l.quantity_remaining*l.unit_cost),0) remaining_cost,COALESCE(SUM(l.quantity_remaining*l.unit_sale_price) FILTER(WHERE l.unit_cost IS NOT NULL),0) forecast_revenue,BOOL_OR(l.quantity_remaining>0 AND l.unit_cost IS NULL) cost_pending FROM inventory_lots l WHERE l.quantity_remaining>0 AND ($4::int IS NULL OR l.product_id=$4) AND ($5::int IS NULL OR l.supplier_id=$5)),
     c AS (SELECT COUNT(*) FILTER(WHERE type='Entrada')::int entries,(SELECT exits FROM s)::int exits,COUNT(*) FILTER(WHERE type='Ajuste')::int adjustments,COALESCE(SUM(quantity) FILTER(WHERE type='Entrada'),0)::int units_in,(SELECT units FROM s)::int units_out FROM pm)
     SELECT c.entries,c.exits,c.adjustments,c.units_in AS \"unitsIn\",c.units_out AS \"unitsOut\",p.cost AS \"entryCostTotal\",p.cost AS \"purchasedCost\",p.units AS \"unitsPurchased\",p.sale AS \"potentialSaleTotal\",p.margin AS \"potentialMargin\",s.cogs AS \"outgoingCost\",s.revenue AS \"recordedRevenue\",s.revenue-s.cogs AS \"realizedMargin\",i.remaining_cost AS \"remainingCost\",i.forecast_revenue AS \"forecastRevenue\",i.forecast_revenue-i.remaining_cost AS \"forecastMargin\",COALESCE(i.cost_pending,FALSE) AS \"costPending\" FROM c,p,s,i`,
    [...args, exitType],
  )
  const range = { from: fromDate, to: toDate }
  let comparison = null
  if (request.query.compare === 'previous') {
    const shiftDate = (value, days) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return date.toISOString().slice(0, 10)
    }
    const days =
      Math.round(
        (Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
          86400000,
      ) + 1
    const previousTo = shiftDate(fromDate, -1)
    const previousFrom = shiftDate(previousTo, -(days - 1))
    const previousArgs = [previousFrom, previousTo, null, productId, supplierId, exitType]
    const { rows: previousRows } = await database.query(
      `WITH pm AS (
         SELECT m.* FROM movements m WHERE m.voided_at IS NULL AND ${dateFilter}
           AND ($4::int IS NULL OR m.product_id=$4)
           AND ($5::int IS NULL OR m.supplier_id=$5 OR EXISTS(SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$5))
       ), purchases AS (
         SELECT COUNT(*)::int AS entries,COALESCE(SUM(quantity),0)::int AS units_in,COALESCE(SUM(quantity*unit_cost),0) AS purchased_cost
         FROM pm WHERE type='Entrada'
       ), sale_rows AS (
         SELECT m.id,m.unit_sale_price,SUM(a.quantity)::int AS units,SUM(a.quantity*a.unit_cost) AS cogs
         FROM pm m JOIN movement_lot_allocations a ON a.movement_id=m.id JOIN inventory_lots l ON l.id=a.lot_id
         WHERE m.type=$6 AND ($5::int IS NULL OR l.supplier_id=$5) GROUP BY m.id,m.unit_sale_price
       ), sales AS (
         SELECT COUNT(*)::int AS exits,COALESCE(SUM(units),0)::int AS units_out,COALESCE(SUM(units*unit_sale_price),0) AS revenue,COALESCE(SUM(cogs),0) AS outgoing_cost
         FROM sale_rows
       ), adjustments AS (SELECT COUNT(*)::int AS total FROM pm WHERE type='Ajuste')
       SELECT purchases.entries,sales.exits,adjustments.total AS adjustments,purchases.units_in AS \"unitsIn\",sales.units_out AS \"unitsOut\",
              purchases.purchased_cost AS \"purchasedCost\",sales.outgoing_cost AS \"outgoingCost\",sales.revenue AS \"recordedRevenue\",
              sales.revenue-sales.outgoing_cost AS \"realizedMargin\"
       FROM purchases,sales,adjustments`,
      previousArgs,
    )
    comparison = { range: { from: previousFrom, to: previousTo }, summary: previousRows[0] }
  }
  const reportProductSelect = productSelect.replaceAll(
    'l.product_id=p.id',
    'l.product_id=p.id AND ($2::int IS NULL OR l.supplier_id=$2)',
  )
  const [products, productMargins] = await Promise.all([
    database.query(
      `${reportProductSelect} WHERE p.active=TRUE AND ($1::int IS NULL OR p.id=$1) AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM product_suppliers ps WHERE ps.product_id=p.id AND ps.supplier_id=$2) OR EXISTS(SELECT 1 FROM movements hm WHERE hm.product_id=p.id AND hm.voided_at IS NULL AND (hm.supplier_id=$2 OR EXISTS(SELECT 1 FROM movement_lot_allocations ha JOIN inventory_lots hl ON hl.id=ha.lot_id WHERE ha.movement_id=hm.id AND hl.supplier_id=$2)))) ORDER BY p.name`,
      [productId, supplierId],
    ),
    database.query(
      `WITH pm AS (
         SELECT m.* FROM movements m WHERE m.voided_at IS NULL AND ${dateFilter}
           AND ($4::int IS NULL OR m.product_id=$4)
           AND ($5::int IS NULL OR m.supplier_id=$5 OR EXISTS (SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$5))
       ), purchases AS (
         SELECT product_id,COUNT(*)::int AS purchase_count,COALESCE(SUM(quantity),0)::int AS units_purchased,
                COALESCE(SUM(quantity*unit_cost),0) AS purchase_cost
         FROM pm WHERE type='Entrada' GROUP BY product_id
       ), sale_rows AS (
         SELECT m.id,m.product_id,m.unit_sale_price,SUM(a.quantity)::int AS units,SUM(a.quantity*a.unit_cost) AS fifo_cost
         FROM pm m JOIN movement_lot_allocations a ON a.movement_id=m.id JOIN inventory_lots l ON l.id=a.lot_id
         WHERE m.type=$6 AND ($5::int IS NULL OR l.supplier_id=$5) GROUP BY m.id,m.product_id,m.unit_sale_price
       ), sales AS (
         SELECT product_id,COUNT(*)::int AS sale_count,COALESCE(SUM(units),0)::int AS units_sold,
                COALESCE(SUM(units*unit_sale_price),0) AS revenue,COALESCE(SUM(fifo_cost),0) AS fifo_cost
         FROM sale_rows GROUP BY product_id
       ), inventory AS (
         SELECT l.product_id,COALESCE(SUM(l.quantity_remaining) FILTER (WHERE l.unit_cost IS NOT NULL),0)::int AS known_units,
                COALESCE(SUM(l.quantity_remaining) FILTER (WHERE l.unit_cost IS NULL),0)::int AS pending_units,
                COALESCE(SUM(l.quantity_remaining*l.unit_cost),0) AS remaining_cost,
                COALESCE(SUM(l.quantity_remaining*l.unit_sale_price) FILTER (WHERE l.unit_cost IS NOT NULL),0) AS forecast_revenue,
                BOOL_OR(l.quantity_remaining>0 AND l.unit_cost IS NULL) AS cost_pending
         FROM inventory_lots l WHERE l.quantity_remaining>0 AND ($4::int IS NULL OR l.product_id=$4) AND ($5::int IS NULL OR l.supplier_id=$5)
         GROUP BY l.product_id
       )
       SELECT p.id AS "productId",p.name,p.code,p.unit,p.active,p.price,COALESCE(pu.purchase_count,0)::int AS "purchaseCount",
              COALESCE(pu.units_purchased,0)::int AS "unitsPurchased",COALESCE(pu.purchase_cost,0) AS "purchaseCost",
              COALESCE(sa.sale_count,0)::int AS "saleCount",COALESCE(sa.units_sold,0)::int AS "unitsSold",
              COALESCE(sa.revenue,0) AS revenue,COALESCE(sa.fifo_cost,0) AS "fifoCost",
              COALESCE(sa.revenue,0)-COALESCE(sa.fifo_cost,0) AS "realizedMargin",
              COALESCE(i.known_units,0)::int AS "knownUnits",COALESCE(i.pending_units,0)::int AS "pendingUnits",
              COALESCE(i.remaining_cost,0) AS "remainingCost",COALESCE(i.forecast_revenue,0) AS "forecastRevenue",
              COALESCE(i.forecast_revenue,0)-COALESCE(i.remaining_cost,0) AS "forecastMargin",COALESCE(i.cost_pending,FALSE) AS "costPending"
       FROM products p LEFT JOIN purchases pu ON pu.product_id=p.id LEFT JOIN sales sa ON sa.product_id=p.id LEFT JOIN inventory i ON i.product_id=p.id
       WHERE ($4::int IS NULL OR p.id=$4) AND ($5::int IS NULL OR EXISTS(SELECT 1 FROM product_suppliers ps WHERE ps.product_id=p.id AND ps.supplier_id=$5) OR EXISTS(SELECT 1 FROM movements hm WHERE hm.product_id=p.id AND hm.voided_at IS NULL AND (hm.supplier_id=$5 OR EXISTS(SELECT 1 FROM movement_lot_allocations ha JOIN inventory_lots hl ON hl.id=ha.lot_id WHERE ha.movement_id=hm.id AND hl.supplier_id=$5))))
       ORDER BY p.name`,
      [...args, exitType],
    ),
  ])
  const margins = productMargins.rows.map((row) => {
    const salePricePending =
      Number(row.price) <= 0 && Number(row.knownUnits) + Number(row.pendingUnits) > 0
    return {
      ...row,
      salePricePending,
      forecastMargin: salePricePending ? null : row.forecastMargin,
      forecastRevenue: salePricePending ? null : row.forecastRevenue,
    }
  })
  const salePricePending = margins.some((row) => row.salePricePending)
  response.json({
    period,
    range,
    comparison,
    filters: { productId, supplierId, from: fromDate, to: toDate },
    summary: {
      ...summary[0],
      salePricePending,
      forecastMargin: salePricePending ? null : summary[0].forecastMargin,
      forecastRevenue: salePricePending ? null : summary[0].forecastRevenue,
    },
    products: products.rows.map((row) => ({ ...row, price: Number(row.price) })),
    productMargins: margins,
  })
})

app.get(
  '/api/reports/product/:productId/movements',
  requireAuth,
  requireAdmin,
  async (request, response) => {
    const productId = positiveId(request.params.productId, 'produto')
    const { period, fromDate, toDate, interval, all } = reportPeriod(request.query, {
      allowAll: true,
    })
    const supplierId = request.query.supplierId
      ? positiveId(request.query.supplierId, 'fornecedor')
      : null
    const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '25', 10) || 25))
    const offset = (page - 1) * limit
    const params = [productId, supplierId, fromDate, toDate, interval, all, limit, offset]
    const dateFilter = `($6::boolean OR (($3::date IS NOT NULL AND m.occurred_at >= ($3::date::timestamp AT TIME ZONE 'America/Fortaleza')) OR ($3::date IS NULL AND m.occurred_at >= NOW()-$5::interval))) AND ($4::date IS NULL OR m.occurred_at < (($4::date + 1)::timestamp AT TIME ZONE 'America/Fortaleza'))`
    const [{ rows }, { rows: count }] = await Promise.all([
      database.query(
        `SELECT m.id,m.type,CASE WHEN m.type='Saída' THEN -COALESCE(x.units,0) ELSE m.quantity END AS quantity,m.reason,m.occurred_at AS date,m.supplier_id AS "supplierId",
              CASE WHEN m.type='Saída' AND $2::int IS NOT NULL THEN (SELECT name FROM suppliers WHERE id=$2) ELSE s.name END AS supplier,
              m.unit_cost AS "unitCost",m.unit_sale_price AS "unitSalePrice",COALESCE(x.fifo_cost,0) AS "fifoCost",
              CASE WHEN m.type='Saída' THEN COALESCE(x.units,0)*m.unit_sale_price ELSE m.quantity*m.unit_cost END AS total
       FROM movements m LEFT JOIN suppliers s ON s.id=m.supplier_id
       LEFT JOIN LATERAL (SELECT SUM(a.quantity)::int AS units,SUM(a.quantity*a.unit_cost) AS fifo_cost FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND ($2::int IS NULL OR l.supplier_id=$2)) x ON m.type='Saída'
       WHERE m.product_id=$1 AND m.voided_at IS NULL AND m.type IN ('Entrada','Saída')
         AND ${dateFilter}
         AND ($2::int IS NULL OR m.supplier_id=$2 OR EXISTS(SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$2))
       ORDER BY m.occurred_at DESC,m.id DESC LIMIT $7 OFFSET $8`,
        params,
      ),
      database.query(
        `SELECT COUNT(*)::int AS total FROM movements m WHERE m.product_id=$1 AND m.voided_at IS NULL AND m.type IN ('Entrada','Saída')
       AND ${dateFilter}
       AND ($2::int IS NULL OR m.supplier_id=$2 OR EXISTS(SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$2))`,
        params.slice(0, 6),
      ),
    ])
    response.json({
      productId,
      period,
      from: fromDate,
      to: toDate,
      page,
      limit,
      total: count[0].total,
      movements: rows,
    })
  },
)

app.get('/api/reports/movements', requireAuth, requireAdmin, async (request, response) => {
  const { fromDate, toDate, interval } = reportPeriod(request.query)
  const productId = request.query.productId ? positiveId(request.query.productId, 'produto') : null
  const supplierId = request.query.supplierId
    ? positiveId(request.query.supplierId, 'fornecedor')
    : null
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '100', 10) || 100))
  const offset = (page - 1) * limit
  const values = [fromDate, toDate, interval, productId, supplierId, limit, offset]
  const where = `m.voided_at IS NULL
    AND (($1::date IS NOT NULL AND m.occurred_at >= ($1::date::timestamp AT TIME ZONE 'America/Fortaleza')) OR ($1::date IS NULL AND m.occurred_at >= NOW()-$3::interval))
    AND ($2::date IS NULL OR m.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Fortaleza'))
    AND ($4::int IS NULL OR m.product_id=$4)
    AND ($5::int IS NULL OR m.supplier_id=$5 OR EXISTS(SELECT 1 FROM movement_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.movement_id=m.id AND l.supplier_id=$5))`
  const [count, result] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total FROM movements m WHERE ${where}`,
      values.slice(0, 5),
    ),
    database.query(
      `SELECT m.id,m.type,m.occurred_at AS date,p.name AS "productName",p.code AS "productCode",p.unit,
              CASE WHEN m.type='Saída' THEN -COALESCE(a.units,0) ELSE m.quantity END AS quantity,
              m.purchase_quantity AS "purchaseQuantity",m.purchase_unit AS "purchaseUnit",m.purchase_conversion AS "purchaseConversion",
              CASE WHEN m.type='Saída' AND $5::int IS NOT NULL THEN (SELECT name FROM suppliers WHERE id=$5) ELSE s.name END AS supplier,
              m.purchase_unit_cost AS "purchaseUnitCost",m.unit_cost AS "unitCost",
              m.unit_sale_price AS "unitSalePrice",COALESCE(a.fifo_cost,0) AS "fifoCost",
              CASE WHEN m.type='Saída' THEN COALESCE(a.units,0)*m.unit_sale_price ELSE m.quantity*m.unit_sale_price END AS revenue,
              m.reason,u.name AS "user"
       FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id LEFT JOIN suppliers s ON s.id=m.supplier_id
       LEFT JOIN LATERAL (
         SELECT SUM(alloc.quantity)::int AS units,SUM(alloc.quantity*alloc.unit_cost) AS fifo_cost
         FROM movement_lot_allocations alloc JOIN inventory_lots l ON l.id=alloc.lot_id
         WHERE alloc.movement_id=m.id AND ($5::int IS NULL OR l.supplier_id=$5)
       ) a ON m.type='Saída'
       WHERE ${where} ORDER BY m.occurred_at,m.id LIMIT $6 OFFSET $7`,
      values,
    ),
  ])
  response.json({ page, limit, total: count.rows[0].total, movements: result.rows })
})

app.get('/api/audit', requireAuth, requireAdmin, async (_request, response) => {
  const { rows } = await database.query(
    `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.details,
            a.created_at AS date, COALESCE(u.name, 'Usuário removido') AS "user"
     FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
     ORDER BY a.created_at DESC LIMIT 1000`,
  )
  response.json(rows)
})

app.get('/api/audit/search', requireAuth, requireAdmin, async (request, response) => {
  const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '25', 10) || 25))
  const offset = (page - 1) * limit
  const search = optionalString(request.query.search, 'busca', 160)
  const pattern = search ? `%${search}%` : null
  const [count, result] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ($1::text IS NULL OR a.action ILIKE $1 OR a.entity ILIKE $1 OR COALESCE(u.name,'') ILIKE $1 OR a.details::text ILIKE $1)`,
      [pattern],
    ),
    database.query(
      `SELECT a.id,a.action,a.entity,a.entity_id AS "entityId",a.details,a.created_at AS date,COALESCE(u.name,'Usuário removido') AS "user"
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
       WHERE ($1::text IS NULL OR a.action ILIKE $1 OR a.entity ILIKE $1 OR COALESCE(u.name,'') ILIKE $1 OR a.details::text ILIKE $1)
       ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    ),
  ])
  response.json({ page, limit, total: count.rows[0].total, events: result.rows })
})

app.use((_request, response) =>
  response
    .status(404)
    .json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.' } }),
)

app.use((error, _request, response, _next) => {
  if (error.code === '23505')
    error = httpError(409, 'DUPLICATE_VALUE', 'Já existe um registro com esses dados.')
  if (error.type === 'entity.parse.failed')
    error = httpError(400, 'INVALID_JSON', 'O corpo da solicitação contém JSON inválido.')
  if (error.type === 'entity.too.large')
    error = httpError(413, 'UPLOAD_TOO_LARGE', 'A imagem deve ter no máximo 5 MB.')
  if ((error.status ?? 500) >= 500) console.error('Erro ao processar requisição:', error)
  response.status(error.status ?? 500).json({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: error.status ? error.message : 'Não foi possível processar a solicitação.',
    },
  })
})
