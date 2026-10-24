import { hashPassword } from './security.js'

export async function migrate(database) {
  const client = await database.connect()

  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(254) NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        session_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50);
      UPDATE users SET must_change_password = FALSE WHERE must_change_password = TRUE;
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(500) NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL UNIQUE,
        contact VARCHAR(80) NOT NULL DEFAULT '',
        email VARCHAR(254) NOT NULL DEFAULT '',
        image_path VARCHAR(100),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(160) NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        unit VARCHAR(30) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        minimum INTEGER NOT NULL DEFAULT 0 CHECK (minimum >= 0),
        price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
        average_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
        image_path VARCHAR(100),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS image_path VARCHAR(100);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path VARCHAR(100);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS average_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (average_cost >= 0);
      ALTER TABLE products ALTER COLUMN average_cost DROP NOT NULL;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_unit VARCHAR(30);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_purchase INTEGER NOT NULL DEFAULT 1 CHECK (units_per_purchase > 0);
      UPDATE products SET purchase_unit=unit WHERE purchase_unit IS NULL;
      ALTER TABLE products ALTER COLUMN purchase_unit SET NOT NULL;

      CREATE TABLE IF NOT EXISTS supplier_quotes (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
        quoted_at DATE NOT NULL DEFAULT CURRENT_DATE,
        note VARCHAR(500) NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS supplier_quotes_lookup_idx ON supplier_quotes (supplier_id, product_id, quoted_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS movements (
        id BIGSERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(20) NOT NULL CHECK (type IN ('Entrada', 'Saída', 'Ajuste')),
        quantity INTEGER NOT NULL CHECK (quantity <> 0),
        reason VARCHAR(500) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS unit_sale_price NUMERIC(12,2) CHECK (unit_sale_price IS NULL OR unit_sale_price >= 0);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS purchase_quantity INTEGER CHECK (purchase_quantity IS NULL OR purchase_quantity > 0);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS purchase_unit VARCHAR(30);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS purchase_conversion INTEGER CHECK (purchase_conversion IS NULL OR purchase_conversion > 0);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS purchase_unit_cost NUMERIC(12,2) CHECK (purchase_unit_cost IS NULL OR purchase_unit_cost >= 0);
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS void_reason VARCHAR(500);
      UPDATE movements SET occurred_at=created_at WHERE occurred_at IS NULL;
      ALTER TABLE movements ALTER COLUMN occurred_at SET DEFAULT NOW();
      ALTER TABLE movements ALTER COLUMN occurred_at SET NOT NULL;
      CREATE INDEX IF NOT EXISTS movements_occurred_at_idx ON movements (occurred_at DESC);
      CREATE TABLE IF NOT EXISTS inventory_lots (
        id BIGSERIAL PRIMARY KEY,
        movement_id BIGINT UNIQUE REFERENCES movements(id) ON DELETE SET NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
        quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
        unit_cost NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
        unit_sale_price NUMERIC(12,2) CHECK (unit_sale_price IS NULL OR unit_sale_price >= 0),
        occurred_at TIMESTAMPTZ NOT NULL,
        source VARCHAR(30) NOT NULL DEFAULT 'purchase',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS inventory_lots_fifo_idx ON inventory_lots (product_id, occurred_at, id) WHERE quantity_remaining > 0;
      CREATE TABLE IF NOT EXISTS movement_lot_allocations (
        movement_id BIGINT NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
        lot_id BIGINT NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost NUMERIC(12,2),
        PRIMARY KEY (movement_id, lot_id)
      );
      ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'purchase';
      INSERT INTO inventory_lots (movement_id, product_id, supplier_id, quantity_received, quantity_remaining, unit_cost, unit_sale_price, occurred_at, source)
        SELECT m.id, m.product_id, m.supplier_id, m.quantity, m.quantity, m.unit_cost, m.unit_sale_price, m.occurred_at, 'purchase'
        FROM movements m WHERE m.type='Entrada' AND m.quantity > 0 AND m.voided_at IS NULL
        ON CONFLICT (movement_id) DO NOTHING;
      INSERT INTO inventory_lots (movement_id, product_id, quantity_received, quantity_remaining, occurred_at, source)
        SELECT m.id, m.product_id, m.quantity, m.quantity, m.occurred_at, 'adjustment'
        FROM movements m WHERE m.type='Ajuste' AND m.quantity > 0 AND m.voided_at IS NULL
        ON CONFLICT (movement_id) DO NOTHING;
      INSERT INTO inventory_lots (product_id, quantity_received, quantity_remaining, occurred_at, source)
        SELECT p.id,
               GREATEST(p.stock - COALESCE((SELECT SUM(ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND ml.type IN ('Entrada','Ajuste') AND ml.quantity > 0),0)
                 + COALESCE((SELECT SUM(-ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND (ml.type='Saída' OR (ml.type='Ajuste' AND ml.quantity<0))),0)
                 - COALESCE((SELECT SUM(l.quantity_received) FROM inventory_lots l WHERE l.product_id=p.id AND l.source='opening'),0),0),
               GREATEST(p.stock - COALESCE((SELECT SUM(ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND ml.type IN ('Entrada','Ajuste') AND ml.quantity > 0),0)
                 + COALESCE((SELECT SUM(-ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND (ml.type='Saída' OR (ml.type='Ajuste' AND ml.quantity<0))),0)
                 - COALESCE((SELECT SUM(l.quantity_received) FROM inventory_lots l WHERE l.product_id=p.id AND l.source='opening'),0),0),
               COALESCE((SELECT MIN(m.occurred_at)-INTERVAL '1 second' FROM movements m WHERE m.product_id=p.id), p.created_at), 'opening'
        FROM products p
        WHERE p.stock + COALESCE((SELECT SUM(-ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND (ml.type='Saída' OR (ml.type='Ajuste' AND ml.quantity<0))),0)
          - COALESCE((SELECT SUM(ml.quantity) FROM movements ml WHERE ml.product_id=p.id AND ml.voided_at IS NULL AND ml.type IN ('Entrada','Ajuste') AND ml.quantity > 0),0)
          > COALESCE((SELECT SUM(l.quantity_received) FROM inventory_lots l WHERE l.product_id=p.id AND l.source='opening'),0);
      UPDATE inventory_lots l SET occurred_at=COALESCE((SELECT MIN(m.occurred_at)-INTERVAL '1 second' FROM movements m WHERE m.product_id=l.product_id),p.created_at)
        FROM products p WHERE l.product_id=p.id AND l.source='opening';
      WITH totals AS (
        SELECT p.id AS product_id, p.stock,
               COALESCE((SELECT SUM(l.quantity_received) FROM inventory_lots l WHERE l.product_id=p.id),0) AS received,
               COALESCE((SELECT SUM(-m.quantity) FROM movements m WHERE m.product_id=p.id AND m.type='Saída' AND m.voided_at IS NULL),0)
                 + COALESCE((SELECT SUM(-m.quantity) FROM movements m WHERE m.product_id=p.id AND m.type='Ajuste' AND m.quantity < 0 AND m.voided_at IS NULL),0) AS consumed
        FROM products p
      ), ranked AS (
        SELECT l.id, t.stock, t.received-t.consumed AS remaining_total,
               SUM(l.quantity_received) OVER (PARTITION BY l.product_id ORDER BY l.occurred_at DESC, l.id DESC) AS reverse_cumulative
        FROM inventory_lots l JOIN totals t ON t.product_id=l.product_id
      )
      UPDATE inventory_lots l SET quantity_remaining=LEAST(l.quantity_received, GREATEST(0, r.remaining_total - (r.reverse_cumulative - l.quantity_received)))
      FROM ranked r WHERE l.id=r.id;
      CREATE TABLE IF NOT EXISTS product_suppliers (
        product_id INTEGER NOT NULL REFERENCES products(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, supplier_id)
      );
      CREATE TABLE IF NOT EXISTS app_migrations (
        name VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS product_suppliers_supplier_idx ON product_suppliers (supplier_id, product_id);
      CREATE INDEX IF NOT EXISTS movements_created_at_idx ON movements (created_at DESC);
      CREATE INDEX IF NOT EXISTS movements_product_id_idx ON movements (product_id);
      UPDATE products p SET average_cost = (
        SELECT ROUND(SUM(m.quantity * m.unit_cost) / NULLIF(SUM(m.quantity) FILTER (WHERE m.unit_cost IS NOT NULL), 0), 2)
        FROM movements m WHERE m.product_id=p.id AND m.type='Entrada' AND m.unit_cost IS NOT NULL
      ) WHERE p.average_cost=0 AND p.stock>0 AND EXISTS (
        SELECT 1 FROM movements m WHERE m.product_id=p.id AND m.type='Entrada' AND m.unit_cost IS NOT NULL
      );
      UPDATE products p SET average_cost=NULL WHERE p.stock>0 AND p.average_cost=0 AND NOT EXISTS (
        SELECT 1 FROM movements m WHERE m.product_id=p.id AND m.type='Entrada' AND m.unit_cost IS NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(80) NOT NULL,
        entity VARCHAR(80) NOT NULL,
        entity_id INTEGER,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
    `)

    const supplierLinksMigration = await client.query(
      "SELECT 1 FROM app_migrations WHERE name='backfill_product_supplier_links'",
    )
    if (!supplierLinksMigration.rowCount) {
      await client.query(`
        INSERT INTO product_suppliers (product_id, supplier_id)
          SELECT id, supplier_id FROM products WHERE supplier_id IS NOT NULL ON CONFLICT DO NOTHING;
        INSERT INTO product_suppliers (product_id, supplier_id)
          SELECT product_id, supplier_id FROM supplier_quotes ON CONFLICT DO NOTHING;
        INSERT INTO product_suppliers (product_id, supplier_id)
          SELECT product_id, supplier_id FROM movements WHERE supplier_id IS NOT NULL ON CONFLICT DO NOTHING;
        INSERT INTO app_migrations (name) VALUES ('backfill_product_supplier_links');
      `)
    }

    const knownUsernames = new Set((await client.query(
      'SELECT LOWER(username) AS username FROM users WHERE username IS NOT NULL',
    )).rows.map((row) => row.username))
    const { rows: usersToMigrate } = await client.query(
      'SELECT id, email FROM users WHERE username IS NULL ORDER BY id',
    )
    for (const user of usersToMigrate) {
      const localPart = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 50)
      const base = localPart.length >= 3 ? localPart : `usuario-${user.id}`
      let username = base
      let attempt = 0
      while (knownUsernames.has(username.toLowerCase())) {
        const suffix = `-${user.id}${attempt ? `-${attempt}` : ''}`
        username = `${base.slice(0, 50 - suffix.length)}${suffix}`
        attempt += 1
      }
      await client.query('UPDATE users SET username = $1 WHERE id = $2', [username, user.id])
      knownUsernames.add(username.toLowerCase())
    }
    await client.query('ALTER TABLE users ALTER COLUMN username SET NOT NULL')
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  await seedUsers(database)
}

async function seedUsers(database) {
  if (process.env.SEED_USERS !== 'true') return

  const accounts = [
    {
      name: process.env.SEED_ADMIN_NAME,
      username: process.env.SEED_ADMIN_USERNAME,
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      role: 'admin',
    },
    {
      name: process.env.SEED_OPERATOR_NAME,
      username: process.env.SEED_OPERATOR_USERNAME,
      email: process.env.SEED_OPERATOR_EMAIL,
      password: process.env.SEED_OPERATOR_PASSWORD,
      role: 'operator',
    },
  ]

  for (const account of accounts) {
    if (!account.name || !account.email || !account.password) {
      throw new Error(`As variáveis de inicialização da conta ${account.role} são obrigatórias quando SEED_USERS=true.`)
    }

    const username = (account.username || account.email.split('@')[0]).trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
      throw new Error(`Defina um usuário válido para a conta ${account.role} (3 a 50 letras, números, pontos, hífens ou sublinhados).`)
    }

    await database.query(
      `INSERT INTO users (name, username, email, password_hash, role, must_change_password)
       VALUES ($1, $2, LOWER($3), $4, $5, FALSE)
       ON CONFLICT DO NOTHING`,
      [account.name.trim(), username, account.email.trim(), await hashPassword(account.password), account.role],
    )
  }
}
