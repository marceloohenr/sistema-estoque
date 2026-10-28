import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  FileBarChart,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Truck,
  Users,
  X,
  Mail,
  MessageCircle,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, json } from './api.js'

const money = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const stockTimeZone = 'America/Fortaleza'
const dateTime = (value) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: stockTimeZone,
  }).format(new Date(value))
const dateInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: stockTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map(({ type, value: part }) => [type, part]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}
const todayInStockZone = (now = new Date()) => dateInput(now)
const reportDateLabel = (value) =>
  value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00`)) : ''
const passwordByteLength = (value) => new TextEncoder().encode(value).length
function formatBrazilianPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
    digits = digits.slice(2)
  digits = digits.slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 2) return `(${digits}`
  const areaCode = digits.slice(0, 2)
  const number = digits.slice(2)
  const firstPartLength = digits.length > 10 ? 5 : 4
  return `(${areaCode}) ${number.slice(0, firstPartLength)}${number.length > firstPartLength ? `-${number.slice(firstPartLength)}` : ''}`
}
const navAdmin = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'produtos', label: 'Produtos', icon: Package },
  { id: 'categorias', label: 'Categorias', icon: Boxes },
  { id: 'fornecedores', label: 'Fornecedores', icon: Truck },
  { id: 'movimentacoes', label: 'Movimentações', icon: ClipboardList },
  { id: 'usuarios', label: 'Usuários e permissões', icon: Users },
  { id: 'relatorios', label: 'Relatórios', icon: FileBarChart },
  { id: 'auditoria', label: 'Auditoria', icon: ShieldCheck },
  { id: 'configuracoes', label: 'Configurações', icon: Settings2 },
]
const navOperator = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'produtos', label: 'Consultar estoque', icon: Package },
  { id: 'movimentacoes', label: 'Movimentações', icon: ArrowDownLeft },
  { id: 'alertas', label: 'Estoque baixo', icon: AlertTriangle },
  { id: 'configuracoes', label: 'Configurações', icon: Settings2 },
]
const emptyData = {
  products: [],
  inactiveProducts: [],
  categories: [],
  suppliers: [],
  users: [],
  movements: [],
  dashboard: { todayCount: 0, week: [], recent: [] },
  audit: [],
  lastPurchases: [],
}

function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [data, setData] = useState(emptyData)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dataError, setDataError] = useState('')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedProductSuppliers, setSelectedProductSuppliers] = useState(null)
  const [pendingCostProduct, setPendingCostProduct] = useState(null)
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [reportsRefresh, setReportsRefresh] = useState({ status: 'idle', error: '' })
  const admin = user?.roleKey === 'admin'
  const lowStock = useMemo(
    () => data.products.filter((product) => product.stock <= product.minimum),
    [data.products],
  )
  const navItems = admin ? navAdmin : navOperator

  async function loadData(account) {
    const base = [
      api('/products'),
      api('/categories'),
      api('/dashboard'),
      api(account.roleKey === 'admin' ? '/suppliers?status=all' : '/suppliers/options'),
    ]
    if (account.roleKey === 'admin') base.push(api('/suppliers/last-purchases'), api('/users'))
    try {
      const result = await Promise.all(base)
      setData({
        products: result[0].filter((product) => product.status === 'Ativo'),
        inactiveProducts: [],
        categories: result[1],
        dashboard: result[2],
        movements: result[2]?.recent ?? [],
        suppliers: result[3] ?? [],
        lastPurchases: result[4] ?? [],
        users: result[5] ?? [],
        audit: [],
      })
      setDataError('')
    } catch (error) {
      setDataError(error.message)
      throw error
    }
  }

  async function refreshReportsData() {
    setReportsRefresh({ status: 'loading', error: '' })
    try {
      await loadData(user)
      setReportsRefresh({ status: 'ready', error: '' })
    } catch (error) {
      setReportsRefresh({ status: 'error', error: error.message })
    }
  }

  useEffect(() => {
    let active = true
    api('/auth/me')
      .then(async ({ user: account }) => {
        if (!active) return
        setUser(account)
        setPage('dashboard')
        await loadData(account)
      })
      .catch((error) => {
        if (active && error.status !== 401) setDataError(error.message)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  function notify(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3500)
  }

  async function handleLogin(username, password) {
    setBusy(true)
    try {
      const { user: account } = await api('/auth/login', json('POST', { username, password }))
      setUser(account)
      setPage('dashboard')
      try {
        await loadData(account)
      } catch (error) {
        notify(`A sessão foi iniciada, mas não foi possível carregar os dados: ${error.message}`)
      }
      return true
    } catch (error) {
      notify(error.message)
      return { saveError: error.message }
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      /* a sessão expira no servidor */
    }
    setUser(null)
    setData(emptyData)
    setPage('dashboard')
  }

  async function save(path, method, body, success) {
    setBusy(true)
    try {
      const result = await api(path, json(method, body))
      setModal(null)
      notify(success)
      if (user) {
        try {
          await loadData(user)
        } catch (error) {
          notify(`${success} A atualização da tela falhou: ${error.message}`)
        }
      }
      return result ?? true
    } catch (error) {
      notify(error.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function updateSupplierStatus(supplier, active) {
    setBusy(true)
    try {
      await api(`/suppliers/${supplier.id}/status`, json('PATCH', { active }))
      setData((current) => ({
        ...current,
        suppliers: current.suppliers.map((item) =>
          item.id === supplier.id ? { ...item, status: active ? 'Ativo' : 'Inativo' } : item,
        ),
        lastPurchases: current.lastPurchases.map((purchase) =>
          String(purchase.supplierId) === String(supplier.id)
            ? { ...purchase, supplierActive: active }
            : purchase,
        ),
      }))
      notify(active ? 'Fornecedor reativado.' : 'Fornecedor inativado.')
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function updateProductStatus(product, active) {
    setBusy(true)
    try {
      await api(`/products/${product.id}/status`, json('PATCH', { active }))
      setData((current) => {
        const all = [...current.products, ...current.inactiveProducts].filter(
          (item) => item.id !== product.id,
        )
        all.push({ ...product, status: active ? 'Ativo' : 'Inativo' })
        const updated = all.map((item) =>
          item.id === product.id ? { ...item, status: active ? 'Ativo' : 'Inativo' } : item,
        )
        return {
          ...current,
          products: updated.filter((item) => item.status === 'Ativo'),
          inactiveProducts: updated.filter((item) => item.status === 'Inativo'),
        }
      })
      notify(active ? 'Produto reativado.' : 'Produto inativado.')
      return true
    } catch (error) {
      notify(error.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function quickCreate(kind, values) {
    const endpoint = kind === 'category' ? '/categories' : '/suppliers'
    const { imageFile, ...recordValues } = values
    setBusy(true)
    try {
      const created = await api(endpoint, json('POST', recordValues))
      if (kind === 'supplier' && imageFile) {
        try {
          await api(`/suppliers/${created.id}/image`, {
            method: 'PUT',
            body: imageFile,
            headers: { 'Content-Type': imageFile.type },
          })
        } catch (error) {
          notify(`Fornecedor salvo, mas a imagem não foi enviada: ${error.message}`)
        }
      }
      try {
        await loadData(user)
      } catch (error) {
        notify(`Cadastro salvo, mas a lista não foi atualizada: ${error.message}`)
      }
      notify(
        `${kind === 'category' ? 'Categoria' : 'Fornecedor'} cadastrado. Continue o cadastro do produto.`,
      )
      return created
    } catch (error) {
      notify(error.message)
      return { error: error.message }
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(values) {
    setBusy(true)
    try {
      const { user: updated } = await api('/auth/change-password', json('POST', values))
      setUser(updated)
      setPage('dashboard')
      await loadData(updated)
      notify('Senha alterada.')
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <div className="login-page">
        <div className="loading-card">Conectando ao sistema…</div>
      </div>
    )
  if (!user) return <Login onLogin={handleLogin} busy={busy} toast={toast} />

  const go = (next) => {
    const enteringReports = next === 'relatorios' && admin && page !== 'relatorios'
    setPage(next)
    setSidebarOpen(false)
    if (enteringReports) void refreshReportsData()
  }
  const create = (kind, item = null) => setModal({ kind, item })
  const createMovement = (product, presetSupplierId = '', allowedProductIds = null) => {
    if (!data.products.length) {
      notify(
        admin
          ? 'Cadastre os produtos e o saldo contado antes de registrar movimentações.'
          : 'O administrador ainda não cadastrou produtos para movimentação.',
      )
      if (admin) go('produtos')
      return
    }
    setModal({
      kind: 'movement',
      item: null,
      productId: product?.id ?? '',
      supplierId: presetSupplierId,
      allowedProductIds,
    })
  }
  const renderPage = () => {
    if (page === 'dashboard')
      return (
        <Dashboard user={user} {...data} lowStock={lowStock} go={go} onMovement={createMovement} />
      )
    if (page === 'produtos')
      return (
        <Products
          products={data.products}
          query={query}
          setQuery={setQuery}
          admin={admin}
          categories={data.categories}
          onAdd={() => create('product')}
          onEdit={(item) => create('product', item)}
          onHistory={setSelectedProduct}
          onSupplierPrices={setSelectedProductSuppliers}
          onActivate={updateProductStatus}
          onMovement={createMovement}
        />
      )
    if (page === 'categorias' && admin)
      return (
        <Categories
          categories={data.categories}
          onAdd={() => create('category')}
          onEdit={(item) => create('category', item)}
          onDelete={(item) =>
            window.confirm(`Inativar a categoria ${item.name}?`) &&
            save(`/categories/${item.id}`, 'DELETE', {}, 'Categoria inativada.')
          }
        />
      )
    if (page === 'fornecedores' && admin)
      return (
        <Suppliers
          suppliers={data.suppliers}
          lastPurchases={data.lastPurchases}
          onAdd={() => create('supplier')}
          onEdit={(item) => create('supplier', item)}
          onDetails={setSelectedSupplier}
          onToggle={updateSupplierStatus}
        />
      )
    if (page === 'usuarios' && admin)
      return (
        <UsersPage
          users={data.users}
          currentUser={user}
          onAdd={() => create('user')}
          onEdit={(item) => create('user', item)}
          onUpdate={(item, values) =>
            save(`/users/${item.id}`, 'PATCH', values, 'Permissões atualizadas.')
          }
        />
      )
    if (page === 'relatorios' && admin) {
      return (
        <>
          {reportsRefresh.status === 'loading' && (
            <div className="report-refresh-status" role="status">
              Atualizando cadastros e filtros. Você já pode consultar o relatório.
            </div>
          )}
          {reportsRefresh.status === 'error' && (
            <div className="report-load-error" role="alert">
              <span>Não foi possível atualizar os cadastros e filtros: {reportsRefresh.error}</span>
              <button className="text-button" onClick={refreshReportsData}>
                Tentar novamente
              </button>
            </div>
          )}
          <Reports
            products={data.products}
            suppliers={data.suppliers}
            onInformCost={(id) =>
              setPendingCostProduct(data.products.find((item) => item.id === id) ?? null)
            }
          />
        </>
      )
    }
    if (page === 'auditoria' && admin)
      return <Audit audit={data.audit} products={data.products} suppliers={data.suppliers} />
    if (page === 'movimentacoes')
      return (
        <Movements
          movements={data.movements}
          products={data.products}
          suppliers={data.suppliers}
          admin={admin}
          onMovement={createMovement}
          onRefresh={() => loadData(user)}
        />
      )
    if (page === 'alertas')
      return <Alerts products={lowStock} go={() => go('produtos')} admin={admin} />
    if (page === 'configuracoes')
      return <Settings user={user} onSubmit={changePassword} busy={busy} />
    return (
      <Dashboard user={user} {...data} lowStock={lowStock} go={go} onMovement={createMovement} />
    )
  }

  async function saveModal(values) {
    const { kind, item } = modal
    const { imageFile, ...recordValues } = values
    const endpoint = {
      product: '/products',
      category: '/categories',
      supplier: '/suppliers',
      user: '/users',
      movement: '/movements',
    }[kind]
    const editPath = item
      ? {
          product: `/products/${item.id}`,
          category: `/categories/${item.id}`,
          supplier: `/suppliers/${item.id}`,
          user: `/users/${item.id}`,
        }[kind]
      : null
    const method = item ? 'PATCH' : 'POST'
    const path = item ? editPath : endpoint
    const success = {
      product: item ? 'Produto atualizado.' : 'Produto cadastrado.',
      category: item ? 'Categoria atualizada.' : 'Categoria cadastrada.',
      supplier: item ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.',
      user: item ? 'Permissões do usuário atualizadas.' : 'Usuário cadastrado.',
      movement:
        recordValues.type === 'Entrada'
          ? 'Compra registrada. Estoque, fornecedor e histórico atualizados.'
          : recordValues.type === 'Saída'
            ? 'Saída registrada. Saldo e custo FIFO atualizados.'
            : 'Ajuste registrado. Saldo atualizado.',
    }[kind]
    const result = await save(path, method, recordValues, success)
    if (result?.saveError) return { error: result.saveError }
    const recordId = item?.id ?? result?.id
    if (result && imageFile && recordId) {
      const resource = kind === 'product' ? 'products' : kind === 'supplier' ? 'suppliers' : null
      if (resource) {
        setBusy(true)
        try {
          await api(`/${resource}/${recordId}/image`, {
            method: 'PUT',
            body: imageFile,
            headers: { 'Content-Type': imageFile.type },
          })
          await loadData(user)
          notify('Cadastro e imagem salvos.')
        } catch (error) {
          notify(`Cadastro salvo, mas a imagem não foi enviada: ${error.message}`)
        } finally {
          setBusy(false)
        }
      }
    }
    return result
  }

  async function savePendingCost(values) {
    setBusy(true)
    try {
      const result = await api(
        `/products/${pendingCostProduct.id}/opening-cost`,
        json('PATCH', values),
      )
      setPendingCostProduct(null)
      notify(
        `Custo registrado para ${result.unitsAssigned} unidade(s); saldo e histórico recalculados.`,
      )
      try {
        await loadData(user)
      } catch (error) {
        notify(`Custo salvo, mas não foi possível atualizar a tela: ${error.message}`)
      }
      return true
    } catch (error) {
      return { error: error.message }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <DialogAccessibilityManager />
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <Boxes size={21} />
          </span>
          <span>
            estoque<span className="brand-light">fácil</span>
            <small>GESTÃO DE ESTOQUE</small>
          </span>
          <button
            className="icon-button mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={19} />
          </button>
        </div>
        <div className="nav-caption">MENU PRINCIPAL</div>
        <nav className="main-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'nav-active' : ''}`}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'alertas' && lowStock.length > 0 && (
                <span className="nav-count">{lowStock.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="user-switch" onClick={logout}>
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span className="user-switch-copy">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Início</span>
            <span className="breadcrumb-sep">/</span>
            <strong>{navItems.find((item) => item.id === page)?.label ?? page}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="notification-button"
              aria-label="Notificações de estoque baixo"
              onClick={() => go('alertas')}
            >
              <Bell size={19} />
              {lowStock.length > 0 && <i />}
            </button>
            <span className="topbar-divider" />
            <button className="profile-button" onClick={() => go('configuracoes')}>
              <span className="avatar avatar-small">{user.name.slice(0, 1)}</span>
              <span>
                <strong>{user.name.split(' ')[0]}</strong>
                <small>{user.role}</small>
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        {dataError && (
          <div className="data-error-banner" role="alert">
            <span>{dataError}</span>
            <button className="text-button" onClick={() => loadData(user).catch(() => {})}>
              Tentar novamente
            </button>
          </div>
        )}
        <div className="page-content">{renderPage()}</div>
        <footer className="app-footer">
          <span>
            Estoque Fácil <span className="footer-dot">·</span> Controle simples, estoque em dia.
          </span>
        </footer>
      </main>
      {selectedSupplier && (
        <SupplierDetailModal
          key={selectedSupplier.id}
          supplier={selectedSupplier}
          products={data.products}
          onClose={() => setSelectedSupplier(null)}
          onPurchase={(supplier, supplierProducts) => {
            setSelectedSupplier(null)
            createMovement(
              null,
              supplier.id,
              supplierProducts.map((product) => product.id),
            )
          }}
          onCreateProduct={(supplier) => {
            setSelectedSupplier(null)
            setModal({ kind: 'product', item: null, supplierId: supplier.id })
          }}
          onSaved={() => loadData(user)}
          notify={notify}
        />
      )}
      {modal && (
        <EntityModal
          modal={modal}
          data={data}
          onClose={() => setModal(null)}
          onSubmit={saveModal}
          onQuickCreate={quickCreate}
          busy={busy}
        />
      )}
      {selectedProduct && (
        <ProductHistoryModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
      {selectedProductSuppliers && (
        <ProductSupplierPricesModal
          product={selectedProductSuppliers}
          onClose={() => setSelectedProductSuppliers(null)}
        />
      )}
      {pendingCostProduct && (
        <PendingCostModal
          product={pendingCostProduct}
          onClose={() => setPendingCostProduct(null)}
          onSubmit={savePendingCost}
          busy={busy}
        />
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  )
}

function Login({ onLogin, busy, toast }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setError('')
    const success = await onLogin(username, password)
    if (!success) setError('Confira o usuário e a senha e tente novamente.')
  }
  return (
    <div className="login-page">
      <div className="login-showcase">
        <div className="login-brand">
          <span className="brand-mark">
            <Boxes size={21} />
          </span>
          <span>
            estoque<span className="brand-light">fácil</span>
          </span>
        </div>
        <div className="showcase-copy">
          <span className="eyebrow">
            <span /> CONTROLE DE ESTOQUE
          </span>
          <h1>
            Seu estoque
            <br />
            em boas mãos.
          </h1>
          <p>
            Organize produtos, acompanhe movimentações e saiba o que precisa de reposição em um só
            lugar.
          </p>
          <div className="showcase-stats">
            <div>
              <strong>Mais controle</strong>
              <span>informações centralizadas</span>
            </div>
            <div>
              <strong>Mais agilidade</strong>
              <span>rotina organizada</span>
            </div>
          </div>
        </div>
        <div className="showcase-decoration decoration-one" />
        <div className="showcase-decoration decoration-two" />
        <div className="login-copyright">Gestão de estoque do armazém</div>
      </div>
      <div className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow login-eyebrow">ACESSO AO SISTEMA</span>
          <h2>Entre na sua conta</h2>
          <p className="login-subtitle">Acesse com seu usuário e senha.</p>
          <label className="field-label" htmlFor="username">
            Usuário
          </label>
          <div className="input-wrap">
            <span className="input-icon">
              <Users size={17} />
            </span>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin ou operador"
              required
            />
          </div>
          <label className="field-label password-label" htmlFor="password">
            Senha
          </label>
          <div className="input-wrap">
            <span className="input-icon">
              <ShieldCheck size={17} />
            </span>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="show-password"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button login-submit" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar no sistema'} <ArrowRight size={17} />
          </button>
          <p className="security-note">
            <ShieldCheck size={14} /> Sua sessão é protegida e expira após 8 horas.
          </p>
        </form>
      </div>
      {toast && <div className="toast toast-error">{toast}</div>}
    </div>
  )
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
  actionLabel,
  actionIcon: Icon = Plus,
  onAction,
  actionDisabled = false,
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button
          className="primary-button heading-button"
          onClick={onAction}
          disabled={actionDisabled}
        >
          <Icon size={17} />
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function Dashboard({ user, products, movements, dashboard, lowStock, go, onMovement }) {
  const hasProducts = products.length > 0
  const totalUnits = products.reduce((sum, product) => sum + Number(product.stock), 0)
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.price, 0)
  const recent = movements.slice(0, 5)
  const stats = [
    [
      'Produtos cadastrados',
      products.length,
      hasProducts ? 'itens no catálogo' : 'cadastre os itens reais',
      Package,
      'blue',
    ],
    [
      'Unidades em estoque',
      totalUnits.toLocaleString('pt-BR'),
      hasProducts ? 'saldo somado' : 'aguardando contagem',
      Boxes,
      'violet',
    ],
    [
      'Estoque baixo',
      lowStock.length,
      hasProducts ? 'produtos para conferir' : 'sem inventário para avaliar',
      AlertTriangle,
      'amber',
    ],
    [
      user.roleKey === 'admin' ? 'Valor em estoque' : 'Movimentações hoje',
      user.roleKey === 'admin' ? money(inventoryValue) : Number(dashboard?.todayCount ?? 0),
      user.roleKey === 'admin'
        ? hasProducts
          ? 'estimativa pelo preço cadastrado'
          : 'após cadastro de produtos'
        : 'registros no sistema',
      user.roleKey === 'admin' ? FileBarChart : ClipboardList,
      'green',
    ],
  ]
  return (
    <>
      <PageHeading
        eyebrow={user.roleKey === 'admin' ? 'PAINEL DO ADMINISTRADOR' : 'PAINEL DO OPERADOR'}
        title={`Olá, ${user.name.split(' ')[0]}`}
        subtitle="Acompanhe o estoque e as movimentações do armazém."
        action
        actionLabel="Nova movimentação"
        onAction={onMovement}
      />
      <section className="stats-grid">
        {stats.map(([label, value, helper, Icon, color]) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon stat-${color}`}>
              <Icon size={19} />
            </div>
            <span className="stat-label">{label}</span>
            <strong className="stat-value">{value}</strong>
            <span className="stat-helper">{helper}</span>
          </article>
        ))}
      </section>
      <DashboardMovementChart week={dashboard?.week ?? []} />
      <section className="dashboard-grid">
        <div className="panel movement-panel">
          <div className="panel-heading">
            <div>
              <h2>Movimentações recentes</h2>
              <p>Últimas operações registradas</p>
            </div>
            <button className="text-button" onClick={() => go('movimentacoes')}>
              Ver histórico <ArrowRight size={15} />
            </button>
          </div>
          <MovementTable movements={recent} products={products} />
        </div>
        <div className="panel low-stock-panel">
          <div className="panel-heading">
            <div>
              <h2>Precisa de reposição</h2>
              <p>Produtos no mínimo ou abaixo dele</p>
            </div>
            <span className="alert-count">{lowStock.length}</span>
          </div>
          {lowStock.length ? (
            <div className="low-stock-list">
              {lowStock.slice(0, 4).map((product) => (
                <div className="low-stock-item" key={product.id}>
                  <span className="low-stock-symbol">
                    <AlertTriangle size={16} />
                  </span>
                  <span className="low-stock-name">
                    <strong>{product.name}</strong>
                    <small>
                      Mínimo: {product.minimum} {product.unit.toLowerCase()}
                    </small>
                  </span>
                  <span className="low-stock-quantity">
                    <strong>{product.stock}</strong>
                    <small>em estoque</small>
                  </span>
                </div>
              ))}
            </div>
          ) : hasProducts ? (
            <EmptyState icon={Check} title="Tudo em dia" text="Nenhum produto abaixo do mínimo." />
          ) : (
            <EmptyState
              icon={Package}
              title="Inventário não cadastrado"
              text="Cadastre os produtos e saldos contados para acompanhar os alertas."
            />
          )}
          {lowStock.length > 4 && (
            <button className="text-button low-stock-link" onClick={() => go('alertas')}>
              Ver todos os alertas <ArrowRight size={15} />
            </button>
          )}
        </div>
      </section>
      <section className="quick-actions">
        <span className="quick-actions-title">Atalhos</span>
        <button onClick={() => go('produtos')}>
          <span className="quick-icon quick-blue">
            <Package size={18} />
          </span>
          <span>
            <strong>Consultar produtos</strong>
            <small>Ver saldo do estoque</small>
          </span>
          <ArrowRight size={16} />
        </button>
        <button onClick={onMovement}>
          <span className="quick-icon quick-green">
            <ArrowDownLeft size={18} />
          </span>
          <span>
            <strong>Registrar movimentação</strong>
            <small>Entrada, saída ou ajuste</small>
          </span>
          <ArrowRight size={16} />
        </button>
        {user.roleKey === 'admin' && (
          <button onClick={() => go('relatorios')}>
            <span className="quick-icon quick-violet">
              <FileBarChart size={18} />
            </span>
            <span>
              <strong>Acessar relatórios</strong>
              <small>Dados do período</small>
            </span>
            <ArrowRight size={16} />
          </button>
        )}
      </section>
    </>
  )
}

function DashboardMovementChart({ week }) {
  const days = week.map((day) => ({
    ...day,
    label: new Date(`${day.key}T12:00:00`)
      .toLocaleDateString('pt-BR', { weekday: 'short' })
      .replace('.', ''),
  }))
  return (
    <section
      className="panel dashboard-chart-panel"
      aria-label="Gráfico de entradas e saídas da última semana"
    >
      <div className="panel-heading">
        <div>
          <h2>Movimentação da semana</h2>
          <p>Unidades que entraram e saíram nos últimos 7 dias</p>
        </div>
        <div className="chart-legend">
          <span>
            <i className="legend-entry" />
            Entradas
          </span>
          <span>
            <i className="legend-exit" />
            Saídas
          </span>
        </div>
      </div>
      <div className="dashboard-rechart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 8, right: 14, left: -14, bottom: 0 }} barGap={5}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--chart-muted)', fontSize: 11 }}
              tickMargin={9}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--chart-muted)', fontSize: 10 }}
              width={34}
            />
            <Tooltip
              content={
                <InventoryChartTooltip
                  formatValue={(value) => `${Number(value).toLocaleString('pt-BR')} un.`}
                />
              }
              cursor={{ fill: 'var(--chart-hover)' }}
            />
            <Bar
              dataKey="entries"
              name="Entradas"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
            />
            <Bar
              dataKey="exits"
              name="Saídas"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function InventoryChartTooltip({ active, payload, label, formatValue = money }) {
  if (!active || !payload?.length) return null
  return (
    <div className="inventory-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.dataKey}>
          <i style={{ background: item.color }} />
          <span>{item.name}</span>
          <b>{formatValue(item.value)}</b>
        </div>
      ))}
    </div>
  )
}

function MovementBadge({ type }) {
  return (
    <span className={`movement-badge badge-${type.toLowerCase()}`}>
      {type === 'Entrada' ? (
        <ArrowDownRight size={13} />
      ) : type === 'Saída' ? (
        <ArrowUpRight size={13} />
      ) : (
        <SlidersHorizontal size={13} />
      )}
      {type}
    </span>
  )
}

function MovementTable({ movements, products }) {
  if (!movements.length)
    return (
      <EmptyState
        icon={ClipboardList}
        title="Sem movimentações"
        text="As operações registradas aparecerão aqui."
      />
    )
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Tabela com rolagem horizontal"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Tipo</th>
            <th>Quantidade</th>
            <th>Responsável</th>
            <th>Data e hora</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => {
            const product = products.find((item) => item.id === movement.productId)
            return (
              <tr key={movement.id}>
                <td>
                  <div className="product-cell">
                    <span className="product-symbol">
                      <Package size={16} />
                    </span>
                    <span>
                      <strong>{product?.name ?? 'Produto'}</strong>
                      <small>{product?.code ?? '-'}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <MovementBadge type={movement.type} />
                </td>
                <td className={movement.quantity < 0 ? 'quantity-negative' : 'quantity-positive'}>
                  {movement.quantity > 0 ? '+' : ''}
                  {movement.quantity} {product?.unit?.toLowerCase() ?? ''}
                </td>
                <td>{movement.user}</td>
                <td className="date-cell">{dateTime(movement.date)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProductFifoPrice({ product, onEdit }) {
  const price = Number(product.price)
  const nextCost = product.nextFifoCost == null ? null : Number(product.nextFifoCost)
  const belowNext = product.stock > 0 && nextCost != null && price < nextCost
  const riskyUnits = Number(product.unitsBelowSaleCost) || 0
  const hasRisk = belowNext || riskyUnits > 0
  return (
    <div className="product-fifo-price">
      <strong>Venda: {money(price)}</strong>
      <span>
        Próxima unidade FIFO:{' '}
        {nextCost == null ? (product.stock > 0 ? 'custo pendente' : 'sem saldo') : money(nextCost)}
      </span>
      {hasRisk && (
        <div className="product-price-warning" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <strong>
              {belowNext ? 'Preço abaixo do custo FIFO' : 'Atenção aos próximos lotes'}
            </strong>
            <span>
              {belowNext
                ? `Perda de ${money(nextCost - price)} por ${product.unit.toLowerCase()} do próximo lote.`
                : `${riskyUnits} ${product.unit.toLowerCase()} no saldo custaram mais que o preço atual.`}
            </span>
            <span>
              Maior custo no saldo: {money(product.highestRemainingCost ?? nextCost)} por{' '}
              {product.unit.toLowerCase()}. A saída é conferida pela quantidade e pelos lotes FIFO.
            </span>
            {onEdit ? (
              <button type="button" className="text-button" onClick={onEdit}>
                Revisar preço de venda
              </button>
            ) : (
              <span>Peça ao administrador para revisar o preço.</span>
            )}
          </div>
        </div>
      )}
      {product.costPending && (
        <span className="product-price-pending">
          Há custo pendente; parte do saldo ainda não permite avaliar o risco.
        </span>
      )}
    </div>
  )
}

function Products({
  products,
  query,
  setQuery,
  admin,
  categories,
  onAdd,
  onEdit,
  onHistory,
  onSupplierPrices,
  onActivate,
  onMovement,
}) {
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('Ativos')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({
    products: [],
    counts: { active: 0, inactive: 0, total: 0 },
    total: 0,
    limit: 25,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit))
  const visible = result.products
  useEffect(() => {
    setPage(1)
  }, [query, category, status])
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({
      page: String(page),
      limit: '25',
      status: !admin || status === 'Ativos' ? 'active' : status === 'Inativos' ? 'inactive' : 'all',
    })
    if (query.trim()) params.set('search', query.trim())
    if (category) params.set('categoryId', category)
    setLoading(true)
    setError('')
    api(`/products/search?${params}`)
      .then((payload) => active && setResult(payload))
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [admin, status, query, category, page, reload, products])
  async function changeStatus(product, active) {
    if (await onActivate(product, active)) setReload((value) => value + 1)
  }
  const hasFilters = Boolean(query || category)
  return (
    <>
      <PageHeading
        eyebrow={admin ? 'CADASTROS' : 'CONSULTA'}
        title={admin ? 'Produtos' : 'Consultar estoque'}
        subtitle={
          admin
            ? 'Cadastre e acompanhe os itens do armazém.'
            : 'Pesquise produtos e confira o saldo disponível.'
        }
        action={admin}
        actionLabel="Adicionar produto"
        onAction={onAdd}
      />
      <div className="panel list-panel">
        <div className="list-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Buscar produtos"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nome, código ou categoria"
            />
          </div>
          <div className="filter-field">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Filtrar produtos por categoria"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Todas as categorias</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          {admin && (
            <div
              className="product-status-filters"
              role="group"
              aria-label="Filtrar produtos por situação"
            >
              {['Ativos', 'Inativos', 'Todos'].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={status === value}
                  className={status === value ? 'selected' : ''}
                  onClick={() => {
                    setStatus(value)
                    setPage(1)
                  }}
                >
                  {value}
                  <span>
                    {value === 'Ativos'
                      ? result.counts.active
                      : value === 'Inativos'
                        ? result.counts.inactive
                        : result.counts.total}
                  </span>
                </button>
              ))}
            </div>
          )}
          <span className="results-count">{result.total} produtos</span>
        </div>
        {error && (
          <div className="report-load-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setReload((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        )}
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabela com rolagem horizontal"
          tabIndex={0}
        >
          <table className="products-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Fornecedor</th>
                <th>Saldo</th>
                <th>Preço de venda e custo FIFO</th>
                <th>Mínimo</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="product-cell">
                      {product.imageUrl ? (
                        <img
                          className="record-thumbnail"
                          src={product.imageUrl}
                          alt={`Imagem de ${product.name}`}
                        />
                      ) : (
                        <span className="product-symbol">
                          <Package size={16} />
                        </span>
                      )}
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.code} · {product.unit}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{product.category}</td>
                  <td>{product.supplier || '—'}</td>
                  <td>
                    <strong
                      className={product.stock <= product.minimum ? 'stock-low' : 'stock-good'}
                    >
                      {product.stock}
                    </strong>{' '}
                    <span className="muted-text">{product.unit.toLowerCase()}</span>
                  </td>
                  <td>
                    <ProductFifoPrice
                      product={product}
                      onEdit={admin ? () => onEdit(product) : null}
                    />
                  </td>
                  <td>
                    {product.minimum} {product.unit.toLowerCase()}
                  </td>
                  <td>
                    <span
                      className={`status-pill ${product.status === 'Inativo' ? 'status-neutral' : product.stock <= product.minimum ? 'status-warning' : 'status-active'}`}
                    >
                      <i />
                      {product.status === 'Inativo'
                        ? 'Inativo'
                        : product.stock <= product.minimum
                          ? 'Estoque baixo'
                          : 'Em estoque'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {product.status === 'Inativo' ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => changeStatus(product, true)}
                        >
                          Reativar
                        </button>
                      ) : (
                        <>
                          <button
                            className="row-action"
                            title="Histórico de entradas"
                            aria-label={`Ver histórico de entradas de ${product.name}`}
                            onClick={() => onHistory(product)}
                          >
                            <History size={15} />
                          </button>
                          {admin && (
                            <button
                              className="row-action"
                              title="Fornecedores e preços"
                              aria-label={`Ver fornecedores e preços de ${product.name}`}
                              onClick={() => onSupplierPrices(product)}
                            >
                              <Store size={15} />
                            </button>
                          )}
                          <button
                            className="row-action"
                            title="Registrar movimentação"
                            aria-label={`Registrar movimentação de ${product.name}`}
                            onClick={() => onMovement(product)}
                          >
                            <ArrowDownLeft size={15} />
                          </button>
                          {admin && (
                            <>
                              <button
                                className="row-action"
                                title="Editar produto"
                                aria-label={`Editar ${product.name}`}
                                onClick={() => onEdit(product)}
                              >
                                <Settings2 size={15} />
                              </button>
                              <button
                                className="row-action danger-action"
                                title="Inativar produto"
                                aria-label={`Inativar ${product.name}`}
                                onClick={() =>
                                  window.confirm(
                                    `Inativar ${product.name}? O saldo precisa estar zerado; o histórico será mantido.`,
                                  ) && changeStatus(product, false)
                                }
                              >
                                <X size={15} />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <p className="table-loading" role="status">
              Carregando produtos…
            </p>
          )}
          {!loading && !error && visible.length === 0 && (
            <EmptyState
              icon={Search}
              title={
                hasFilters
                  ? 'Nenhum produto encontrado'
                  : status === 'Inativos'
                    ? 'Nenhum produto inativo'
                    : 'Nenhum produto cadastrado'
              }
              text={
                hasFilters
                  ? 'Altere os filtros para ampliar a busca.'
                  : status === 'Inativos'
                    ? 'Produtos inativados aparecerão aqui.'
                    : admin
                      ? 'Adicione o primeiro produto do armazém.'
                      : 'Aguardando o administrador cadastrar os itens do armazém.'
              }
            />
          )}
        </div>
        <div className="table-footer">
          <span>
            Exibindo {visible.length ? (page - 1) * result.limit + 1 : 0}–
            {Math.min(page * result.limit, result.total)} de {result.total} produtos
          </span>
          <div className="table-pagination">
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Categories({ categories, onAdd, onEdit, onDelete }) {
  return (
    <>
      <PageHeading
        eyebrow="CADASTROS"
        title="Categorias"
        subtitle="Organize os produtos por tipo."
        action
        actionLabel="Adicionar categoria"
        onAction={onAdd}
      />
      <div className="panel list-panel">
        <div className="simple-list">
          {categories.length ? (
            categories.map((item) => (
              <div className="simple-list-item" key={item.id}>
                <span className="simple-icon">
                  <Boxes size={19} />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description || `${item.productCount} produtos vinculados`}</small>
                </span>
                <span className="item-code">{item.productCount} produtos</span>
                <button className="row-action" title="Editar" onClick={() => onEdit(item)}>
                  <Settings2 size={15} />
                </button>
                <button
                  className="row-action danger-action"
                  title="Inativar"
                  onClick={() => onDelete(item)}
                >
                  <X size={15} />
                </button>
              </div>
            ))
          ) : (
            <EmptyState
              icon={Boxes}
              title="Nenhuma categoria cadastrada"
              text="Cadastre categorias usadas pelo armazém."
            />
          )}
        </div>
      </div>
    </>
  )
}

function Suppliers({ suppliers, lastPurchases, onAdd, onEdit, onDetails, onToggle }) {
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [priceSupplier, setPriceSupplier] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const visibleSuppliers = suppliers.filter(
    (item) =>
      statusFilter === 'Todos' || item.status === (statusFilter === 'Ativos' ? 'Ativo' : 'Inativo'),
  )
  const cheapestByProduct = new Map()
  for (const purchase of lastPurchases) {
    if (purchase.unitCost == null) continue
    const previous = cheapestByProduct.get(purchase.productId)
    if (previous === undefined || Number(purchase.unitCost) < previous)
      cheapestByProduct.set(purchase.productId, Number(purchase.unitCost))
  }
  const visiblePurchases = lastPurchases
    .filter(
      (purchase) =>
        (!priceSupplier || String(purchase.supplierId) === priceSupplier) &&
        `${purchase.productName} ${purchase.productCode} ${purchase.supplier}`
          .toLowerCase()
          .includes(productSearch.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.unitCost == null ? Number.POSITIVE_INFINITY : Number(a.unitCost)) -
          (b.unitCost == null ? Number.POSITIVE_INFINITY : Number(b.unitCost)) ||
        a.productName.localeCompare(b.productName, 'pt-BR'),
    )

  return (
    <>
      <PageHeading
        eyebrow="CADASTROS"
        title="Fornecedores"
        subtitle="Contatos, produtos vinculados e comparação pelos custos da última compra."
        action
        actionLabel="Adicionar fornecedor"
        onAction={onAdd}
      />
      <div className="list-toolbar supplier-toolbar">
        <div
          className="supplier-status-filters"
          role="group"
          aria-label="Filtrar fornecedores por situação"
        >
          {['Todos', 'Ativos', 'Inativos'].map((filter) => (
            <button
              type="button"
              key={filter}
              className={`supplier-filter-button ${statusFilter === filter ? 'selected' : ''}`}
              aria-pressed={statusFilter === filter}
              onClick={() => setStatusFilter(filter)}
            >
              {filter}
              <span>
                {filter === 'Todos'
                  ? suppliers.length
                  : suppliers.filter(
                      (item) => item.status === (filter === 'Ativos' ? 'Ativo' : 'Inativo'),
                    ).length}
              </span>
            </button>
          ))}
        </div>
        <span className="results-count">{visibleSuppliers.length} fornecedores</span>
      </div>
      <div className="supplier-grid">
        {visibleSuppliers.length ? (
          visibleSuppliers.map((item) => {
            const active = item.status === 'Ativo'
            return (
              <article
                className={`panel supplier-card ${!active ? 'supplier-card-inactive' : ''}`}
                key={item.id}
              >
                {item.imageUrl ? (
                  <img
                    className="supplier-photo"
                    src={item.imageUrl}
                    alt={`Imagem de ${item.name}`}
                  />
                ) : (
                  <span className="supplier-mark">
                    <Truck size={20} />
                  </span>
                )}
                <div className="supplier-title">
                  <h2>{item.name}</h2>
                  <span className={`status-pill ${active ? 'status-active' : 'status-warning'}`}>
                    <i />
                    {item.status}
                  </span>
                </div>
                <div className="supplier-detail">
                  <span>Telefone</span>
                  <strong>{item.contact || '—'}</strong>
                </div>
                <div className="supplier-detail">
                  <span>E-mail</span>
                  <strong>{item.email || '—'}</strong>
                </div>
                <div className="supplier-products">
                  <Package size={15} /> {item.products} produtos vinculados
                </div>
                <div className="supplier-ctas">
                  <button
                    className="secondary-button"
                    disabled={!active || !item.contact}
                    onClick={() =>
                      window.open(
                        whatsAppUrl(item.contact, item.name),
                        '_blank',
                        'noopener,noreferrer',
                      )
                    }
                  >
                    <MessageCircle size={14} /> WhatsApp
                  </button>
                  <a
                    className={`secondary-button ${!active || !item.email ? 'button-disabled' : ''}`}
                    href={active && item.email ? emailUrl(item.email, item.name) : undefined}
                    aria-disabled={!active || !item.email}
                  >
                    <Mail size={14} /> E-mail
                  </a>
                </div>
                <div className="row-actions">
                  <button className="secondary-button" onClick={() => onDetails(item)}>
                    Produtos e preços
                  </button>
                  {active && (
                    <button className="secondary-button" onClick={() => onEdit(item)}>
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label={`${active ? 'Inativar' : 'Ativar'} fornecedor ${item.name}`}
                    className="supplier-status-action"
                    onClick={() => onToggle(item, !active)}
                  >
                    <span className={`supplier-switch ${active ? 'on' : ''}`}>
                      <i />
                    </span>
                    {active ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
              </article>
            )
          })
        ) : (
          <div className="panel supplier-empty">
            <EmptyState
              icon={Truck}
              title={
                statusFilter === 'Inativos'
                  ? 'Nenhum fornecedor inativo'
                  : 'Nenhum fornecedor encontrado'
              }
              text="Ajuste o filtro ou cadastre um fornecedor."
            />
          </div>
        )}
      </div>
      <section className="panel list-panel price-comparison-panel">
        <div className="panel-heading">
          <div>
            <h2>Comparação pela última compra</h2>
            <p>
              Mostra o custo unitário mais recente registrado para cada combinação de produto e
              fornecedor.
            </p>
          </div>
          <span className="results-count">{visiblePurchases.length} preços</span>
        </div>
        <div className="list-toolbar price-filter-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Buscar produto na comparação de preços"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Buscar produto ou fornecedor"
            />
          </div>
          <label className="filter-field">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Filtrar comparação por fornecedor"
              value={priceSupplier}
              onChange={(event) => setPriceSupplier(event.target.value)}
            >
              <option value="">Todos os fornecedores</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.status === 'Inativo' ? ' (inativo)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabela com rolagem horizontal"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Fornecedor</th>
                <th>Última compra</th>
                <th>Quantidade</th>
                <th>Custo unitário</th>
                <th>Comparação</th>
              </tr>
            </thead>
            <tbody>
              {visiblePurchases.map((purchase) => (
                <tr key={`${purchase.productId}-${purchase.supplierId}`}>
                  <td>
                    <strong>{purchase.productName}</strong>
                    <small className="cell-subtext">
                      {purchase.productCode} · {purchase.unit}
                    </small>
                  </td>
                  <td>
                    {purchase.supplier}
                    {!purchase.supplierActive && (
                      <small className="cell-subtext">Fornecedor inativo</small>
                    )}
                  </td>
                  <td>{dateTime(purchase.date)}</td>
                  <td>
                    {purchase.quantity} {purchase.unit.toLowerCase()}
                  </td>
                  <td>
                    <strong>
                      {purchase.unitCost == null ? 'Custo pendente' : money(purchase.unitCost)}
                    </strong>
                  </td>
                  <td>
                    {purchase.unitCost == null ? (
                      <span className="muted-text">Não comparável</span>
                    ) : Number(purchase.unitCost) === cheapestByProduct.get(purchase.productId) ? (
                      <span className="status-pill status-active">
                        <i />
                        Menor custo de compra
                      </span>
                    ) : (
                      <span className="muted-text">Há custo menor</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiblePurchases.length === 0 && (
            <EmptyState
              icon={FileBarChart}
              title="Sem histórico de compras"
              text="Registre entradas para comparar os fornecedores."
            />
          )}
        </div>
        <div className="table-footer">
          <span>
            A comparação usa a última compra real por fornecedor. Cotações aparecem separadamente no
            histórico.
          </span>
          <span>Menor custo primeiro</span>
        </div>
      </section>
    </>
  )
}

function whatsAppUrl(phone, supplierName, productName = '') {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const number = digits.length <= 11 && !digits.startsWith('55') ? `55${digits}` : digits
  const text = productName
    ? `Olá, ${supplierName}! Gostaria de receber uma cotação atualizada do produto ${productName}. Pode me informar o preço e a disponibilidade?`
    : `Olá, ${supplierName}! Gostaria de conversar sobre os produtos e preços disponíveis. Quando puder, entre em contato comigo.`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

function emailUrl(email, supplierName, productName = '') {
  const subject = productName ? `Cotação: ${productName}` : 'Contato sobre produtos e preços'
  const body = productName
    ? `Olá, ${supplierName}!\n\nGostaria de receber uma cotação atualizada do produto ${productName}. Pode me informar o preço e a disponibilidade?\n\nObrigado.`
    : `Olá, ${supplierName}!\n\nGostaria de conversar sobre os produtos e preços disponíveis. Quando puder, entre em contato comigo.\n\nObrigado.`
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function SupplierDetailModal({
  supplier,
  products,
  onClose,
  onSaved,
  onPurchase,
  onCreateProduct,
  notify,
}) {
  const localToday = todayInStockZone()
  const [quotes, setQuotes] = useState([])
  const [entries, setEntries] = useState([])
  const [quotePage, setQuotePage] = useState(1)
  const [entryPage, setEntryPage] = useState(1)
  const [quoteTotal, setQuoteTotal] = useState(0)
  const [entryTotal, setEntryTotal] = useState(0)
  const [supplierProducts, setSupplierProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [linkProductId, setLinkProductId] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quotedAt, setQuotedAt] = useState(localToday)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [unlinkingProductId, setUnlinkingProductId] = useState(null)
  const [error, setError] = useState('')
  const historyRequest = useRef(0)
  const selectedProduct = supplierProducts.find(
    (product) => String(product.id) === String(productId),
  )
  const linkedProductIds = new Set(supplierProducts.map((product) => String(product.id)))
  const availableProducts = products.filter((product) => !linkedProductIds.has(String(product.id)))

  async function refresh() {
    const requestId = ++historyRequest.current
    setLoading(true)
    try {
      const [quoteHistory, entryHistory, linkedProducts] = await Promise.all([
        api(`/suppliers/${supplier.id}/quotes?page=${quotePage}&limit=20`),
        api(`/suppliers/${supplier.id}/entries?page=${entryPage}&limit=20`),
        api(`/suppliers/${supplier.id}/products`),
      ])
      if (requestId !== historyRequest.current) return
      setQuotes(quoteHistory.quotes)
      setQuoteTotal(quoteHistory.total)
      setEntries(entryHistory.entries)
      setEntryTotal(entryHistory.total)
      setSupplierProducts(linkedProducts)
      setError('')
      const linkedIds = new Set(linkedProducts.map((product) => String(product.id)))
      const available = products.filter((product) => !linkedIds.has(String(product.id)))
      setLinkProductId((current) =>
        available.some((product) => String(product.id) === String(current))
          ? current
          : String(available[0]?.id ?? ''),
      )
      setProductId((current) =>
        linkedProducts.some((product) => String(product.id) === String(current))
          ? current
          : String(linkedProducts[0]?.id ?? ''),
      )
    } catch (requestError) {
      if (requestId === historyRequest.current) setError(requestError.message)
    } finally {
      if (requestId === historyRequest.current) setLoading(false)
    }
  }
  useEffect(() => {
    refresh()
    return () => {
      historyRequest.current += 1
    }
  }, [supplier.id, quotePage, entryPage])

  async function linkExistingProduct(event) {
    event.preventDefault()
    if (!linkProductId) return
    setLinkBusy(true)
    setError('')
    try {
      await api(
        `/suppliers/${supplier.id}/products`,
        json('POST', { productId: Number(linkProductId) }),
      )
      await refresh()
      await onSaved()
      notify('Produto vinculado ao fornecedor.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLinkBusy(false)
    }
  }

  async function unlinkProduct(product) {
    const confirmed = window.confirm(
      `Desvincular ${product.name} de ${supplier.name}? O produto continuará cadastrado e as compras e cotações já registradas serão mantidas no histórico.`,
    )
    if (!confirmed) return
    setUnlinkingProductId(product.id)
    setError('')
    try {
      await api(`/suppliers/${supplier.id}/products/${product.id}`, { method: 'DELETE' })
      await refresh()
      await onSaved()
      notify('Produto desvinculado. O histórico de compras e cotações foi preservado.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUnlinkingProductId(null)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(
        `/suppliers/${supplier.id}/quotes`,
        json('POST', {
          productId: Number(productId),
          unitPrice: Number(unitPrice),
          quotedAt,
          note,
        }),
      )
      setUnitPrice('')
      setNote('')
      if (quotePage !== 1) setQuotePage(1)
      else await refresh()
      await onSaved()
      notify('Cotação registrada. O estoque não foi alterado.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const historyPager = (current, total, setCurrent) =>
    total > 20 && (
      <div className="table-pagination supplier-history-pagination">
        <span>
          Página {current} de {Math.ceil(total / 20)}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={current <= 1 || loading}
          onClick={() => setCurrent((value) => value - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={current >= Math.ceil(total / 20) || loading}
          onClick={() => setCurrent((value) => value + 1)}
        >
          Próxima
        </button>
      </div>
    )
  const supplierHistory = (
    <div className="supplier-history-grid">
      <div className="quote-history">
        <div className="panel-heading">
          <div>
            <h3>Compras recebidas</h3>
            <p>Entradas reais deste fornecedor e saldo restante dos lotes.</p>
          </div>
          <span className="results-count">{entryTotal} registros</span>
        </div>
        {loading ? (
          <p className="quote-empty">Carregando histórico…</p>
        ) : entries.length ? (
          <div className="quote-list">
            {entries.map((entry) => (
              <article className="quote-row" key={entry.id}>
                <div>
                  <strong>
                    {entry.productName}
                    {entry.voidedAt ? ' · estornada' : ''}
                  </strong>
                  <small>
                    {entry.productCode} · {entry.quantity} {entry.unit.toLowerCase()} ·{' '}
                    {dateTime(entry.date)}
                    {!entry.voidedAt && ` · ${entry.quantityRemaining ?? '—'} restantes`}
                  </small>
                </div>
                <div className="entry-price-summary">
                  <strong className="quote-price">
                    Custo: {entry.unitCost == null ? 'Custo pendente' : money(entry.unitCost)}
                  </strong>
                  <strong className="quote-price">
                    Venda: {entry.unitSalePrice == null ? '—' : money(entry.unitSalePrice)}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="quote-empty">Ainda não há compras registradas para este fornecedor.</p>
        )}
        {historyPager(entryPage, entryTotal, setEntryPage)}
      </div>
      <div className="quote-history">
        <div className="panel-heading">
          <div>
            <h3>Cotações recebidas</h3>
            <p>Preços informados, sem recebimento de mercadoria.</p>
          </div>
          <span className="results-count">{quoteTotal} registros</span>
        </div>
        {loading ? (
          <p className="quote-empty">Carregando histórico…</p>
        ) : quotes.length ? (
          <div className="quote-list">
            {quotes.map((quote) => (
              <article className="quote-row" key={quote.id}>
                <div>
                  <strong>{quote.productName}</strong>
                  <small>
                    {quote.productCode} ·{' '}
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
                      new Date(`${quote.quotedAt.slice(0, 10)}T12:00:00`),
                    )}
                  </small>
                  {quote.note && <p>{quote.note}</p>}
                </div>
                <strong className="quote-price">
                  {money(quote.unitPrice)} <small>/ {quote.unit.toLowerCase()}</small>
                </strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="quote-empty">Ainda não há cotações registradas para este fornecedor.</p>
        )}
        {historyPager(quotePage, quoteTotal, setQuotePage)}
      </div>
    </div>
  )

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <ModalDialog
        className="modal-card supplier-detail-modal"
        label={`Fornecedor ${supplier.name}`}
        onClose={onClose}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">FORNECEDOR</span>
            <h2>{supplier.name}</h2>
            <p>Produtos vinculados, compras recebidas e cotações deste fornecedor.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        {error && (
          <div className="report-load-error" role="alert">
            <span>{error}</span>
            <button type="button" className="text-button" onClick={refresh}>
              Tentar novamente
            </button>
          </div>
        )}
        <div className="supplier-detail-ctas">
          <button
            className="secondary-button"
            disabled={!supplier.contact}
            onClick={() =>
              window.open(
                whatsAppUrl(supplier.contact, supplier.name, selectedProduct?.name),
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            <MessageCircle size={15} /> Pedir cotação no WhatsApp
          </button>
          <a
            className={`secondary-button ${!supplier.email ? 'button-disabled' : ''}`}
            href={
              supplier.email
                ? emailUrl(supplier.email, supplier.name, selectedProduct?.name)
                : undefined
            }
            aria-disabled={!supplier.email}
          >
            <Mail size={15} /> Pedir cotação por e-mail
          </a>
          {supplier.status === 'Ativo' && (
            <button
              className="primary-button"
              disabled={!supplierProducts.length}
              title={
                !supplierProducts.length
                  ? 'Vincule um produto antes de registrar a compra.'
                  : 'Registrar compra deste fornecedor'
              }
              onClick={() => onPurchase(supplier, supplierProducts)}
            >
              <ArrowDownLeft size={15} /> Registrar compra
            </button>
          )}
        </div>
        {supplierHistory}
        <div className="supplier-detail-body">
          <section className="supplier-linked-products">
            <div className="panel-heading">
              <div>
                <h3>Produtos deste fornecedor</h3>
                <p>Vincule itens existentes ou cadastre um produto já associado.</p>
              </div>
              {supplier.status === 'Ativo' && (
                <button className="primary-button" onClick={() => onCreateProduct(supplier)}>
                  <Plus size={15} /> Cadastrar produto
                </button>
              )}
            </div>
            {supplier.status === 'Ativo' && (
              <form className="supplier-link-form" onSubmit={linkExistingProduct}>
                <select
                  aria-label="Produto para vincular ao fornecedor"
                  className="form-control"
                  value={linkProductId}
                  onChange={(event) => setLinkProductId(event.target.value)}
                  disabled={!availableProducts.length}
                >
                  <option value="">
                    {availableProducts.length
                      ? 'Selecione um produto existente'
                      : 'Todos os produtos ativos já estão vinculados'}
                  </option>
                  {availableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.code}
                    </option>
                  ))}
                </select>
                <button className="secondary-button" disabled={!linkProductId || linkBusy}>
                  <Plus size={14} />
                  {linkBusy ? 'Vinculando…' : 'Vincular produto'}
                </button>
              </form>
            )}
            {loading ? (
              <p className="quote-empty">Carregando produtos vinculados…</p>
            ) : supplierProducts.length ? (
              <div className="supplier-linked-list">
                {supplierProducts.map((product) => (
                  <article
                    className="supplier-linked-item supplier-linked-product-card"
                    key={product.id}
                  >
                    <div className="supplier-linked-summary">
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.code} · {product.category} · saldo {product.stock}{' '}
                          {product.unit.toLowerCase()}
                        </small>
                      </span>
                      <span>Venda atual: {money(product.price)}</span>
                    </div>
                    <button
                      type="button"
                      className="supplier-unlink-button"
                      aria-label={`Desvincular ${product.name} deste fornecedor`}
                      title="Desvincular produto; o histórico será mantido"
                      disabled={unlinkingProductId === product.id || linkBusy}
                      onClick={() => unlinkProduct(product)}
                    >
                      <X size={14} />
                      {unlinkingProductId === product.id ? 'Desvinculando…' : 'Desvincular'}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="quote-empty">
                Nenhum produto vinculado. Vincule ou cadastre um produto para começar.
              </p>
            )}
            {supplier.status !== 'Ativo' && (
              <p className="supplier-inactive-note">
                Fornecedor inativo. Reative o cadastro para vinculá-lo a novos produtos.
              </p>
            )}
          </section>
          {supplier.status === 'Ativo' && (
            <form className="quote-form" onSubmit={submit}>
              <div>
                <h3>Registrar cotação recebida</h3>
                <p className="field-hint">
                  Escolha um produto já vinculado. A cotação não altera o estoque.
                </p>
              </div>
              {supplierProducts.length ? (
                <>
                  <label className="field-label" htmlFor="quote-product">
                    Produto deste fornecedor
                  </label>
                  <select
                    id="quote-product"
                    className="form-control"
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    {supplierProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.code}
                      </option>
                    ))}
                  </select>
                  <div className="form-grid">
                    <div>
                      <label className="field-label" htmlFor="quote-price">
                        Preço unitário (R$)
                      </label>
                      <input
                        id="quote-price"
                        className="form-control"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={unitPrice}
                        onChange={(event) => setUnitPrice(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="quote-date">
                        Data da cotação
                      </label>
                      <input
                        id="quote-date"
                        className="form-control"
                        type="date"
                        value={quotedAt}
                        onChange={(event) => setQuotedAt(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <label className="field-label" htmlFor="quote-note">
                    Observação
                  </label>
                  <input
                    id="quote-note"
                    className="form-control"
                    maxLength="500"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Prazo, condições ou detalhes opcionais"
                  />
                  <div className="quote-actions">
                    <span>O registro não altera o saldo do estoque.</span>
                    <button className="primary-button" disabled={busy}>
                      <Check size={15} />
                      {busy ? 'Salvando…' : 'Registrar cotação'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="quote-empty">
                  Vincule um produto acima antes de registrar uma cotação.
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
            </form>
          )}
        </div>
      </ModalDialog>
    </div>
  )
}

function UsersPage({ users, currentUser, onAdd, onEdit, onUpdate }) {
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRAÇÃO"
        title="Usuários e permissões"
        subtitle="Gerencie quem pode acessar o sistema."
        action
        actionLabel="Adicionar usuário"
        onAction={onAdd}
      />
      <div className="panel list-panel">
        <div className="panel-heading users-heading">
          <div>
            <h2>Equipe</h2>
            <p>Os operadores consultam estoque e registram movimentações.</p>
          </div>
          <span className="results-count">{users.length} usuários</span>
        </div>
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabela com rolagem horizontal"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="product-cell">
                      <span className="avatar table-avatar">{item.name.slice(0, 1)}</span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          @{item.username} · {item.email}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`role-pill ${item.roleKey === 'admin' ? 'role-admin' : 'role-operator'}`}
                    >
                      {item.roleKey === 'admin' ? <ShieldCheck size={13} /> : <Package size={13} />}
                      {item.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${item.status === 'Ativo' ? 'status-active' : 'status-warning'}`}
                    >
                      <i />
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="secondary-button" onClick={() => onEdit(item)}>
                        Gerenciar
                      </button>
                      {item.id !== currentUser.id && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            onUpdate(item, { role: item.roleKey, active: item.status !== 'Ativo' })
                          }
                        >
                          {item.status === 'Ativo' ? 'Inativar' : 'Reativar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="permission-note">
          <ShieldCheck size={17} />
          <span>
            <strong>Proteção aplicada no servidor:</strong> operadores não podem alterar cadastros
            administrativos nem consultar a auditoria.
          </span>
        </div>
      </div>
    </>
  )
}

function Movements({ movements, products, suppliers, admin, onMovement, onRefresh }) {
  const [query, setQuery] = useState('')
  const [productId, setProductId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ movements: [], total: 0, limit: 25 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [correcting, setCorrecting] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ page: String(page), limit: '25' })
    if (query.trim()) params.set('search', query.trim())
    if (productId) params.set('productId', productId)
    if (supplierId) params.set('supplierId', supplierId)
    if (type) params.set('type', type)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    setLoading(true)
    setLoadError('')
    api(`/movements/search?${params}`)
      .then((payload) => active && setResult(payload))
      .catch((cause) => active && setLoadError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [page, query, productId, supplierId, type, from, to, reload, movements])
  const shown = result.movements
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit))
  const hasFilters = Boolean(query || productId || supplierId || type || from || to)
  function updateFilter(setter) {
    return (event) => {
      setter(event.target.value)
      setPage(1)
    }
  }
  async function refreshList() {
    await onRefresh()
    setReload((value) => value + 1)
  }
  async function reversePurchase(item) {
    if (
      !window.confirm(
        'Estornar esta compra? O sistema vai recalcular os lotes FIFO e validar as saídas já registradas.',
      )
    )
      return
    const reason = window.prompt('Informe o motivo do estorno:')
    if (!reason?.trim()) return
    try {
      await api(`/movements/${item.id}/reverse`, json('POST', { reason }))
      await refreshList()
    } catch (cause) {
      setError(cause.message)
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="CONTROLE DE ESTOQUE"
        title="Movimentações"
        subtitle="Histórico persistente de entradas, saídas e ajustes."
        action
        actionLabel="Nova movimentação"
        onAction={onMovement}
      />
      <div className="panel list-panel">
        <div className="list-toolbar movement-filters">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Filtrar movimentações"
              value={query}
              onChange={updateFilter(setQuery)}
              placeholder="Produto, código, fornecedor, responsável ou observação"
            />
          </div>
          <div className="filter-field">
            <select
              aria-label="Filtrar por produto"
              value={productId}
              onChange={updateFilter(setProductId)}
            >
              <option value="">Todos os produtos</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <select
              aria-label="Filtrar por fornecedor"
              value={supplierId}
              onChange={updateFilter(setSupplierId)}
            >
              <option value="">Todos os fornecedores</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <select
              aria-label="Filtrar por tipo de movimentação"
              value={type}
              onChange={updateFilter(setType)}
            >
              <option value="">Todos os tipos</option>
              <option>Entrada</option>
              <option>Saída</option>
              <option>Ajuste</option>
            </select>
          </div>
          <label className="movement-date-filter">
            De
            <input
              aria-label="Data inicial"
              type="date"
              value={from}
              onChange={updateFilter(setFrom)}
            />
          </label>
          <label className="movement-date-filter">
            Até
            <input aria-label="Data final" type="date" value={to} onChange={updateFilter(setTo)} />
          </label>
          {hasFilters && (
            <button
              type="button"
              className="text-button clear-filters-button"
              onClick={() => {
                setQuery('')
                setProductId('')
                setSupplierId('')
                setType('')
                setFrom('')
                setTo('')
                setPage(1)
              }}
            >
              Limpar filtros
            </button>
          )}
          <span className="results-count">{result.total} registros</span>
        </div>
        {loadError && (
          <div className="report-load-error" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setReload((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        )}
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabela com rolagem horizontal"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Data e hora</th>
                <th>Produto</th>
                <th>Tipo</th>
                <th>Quantidade</th>
                <th>Custo FIFO / margem</th>
                <th>Responsável</th>
                <th>Observação</th>
                {admin && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id}>
                  <td>{dateTime(item.date)}</td>
                  <td>
                    {products.find((product) => product.id === item.productId)?.name ??
                      'Produto inativo'}
                  </td>
                  <td>
                    <MovementBadge type={item.type} />
                    {item.voidedAt && <small className="cell-subtext">Estornada</small>}
                  </td>
                  <td className={item.quantity < 0 ? 'quantity-negative' : 'quantity-positive'}>
                    {item.quantity > 0 ? '+' : ''}
                    {item.quantity}
                  </td>
                  <td>
                    {item.voidedAt ? (
                      '—'
                    ) : item.type === 'Saída' ? (
                      <>
                        <span>Custo: {money(item.fifoCost)}</span>
                        <small className="cell-subtext">
                          Margem: {money(Number(item.revenue) - Number(item.fifoCost))}
                        </small>
                      </>
                    ) : item.type === 'Entrada' && item.unitCost != null ? (
                      money(Number(item.quantity) * Number(item.unitCost))
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{item.user}</td>
                  <td>{item.voidedAt ? `Estorno: ${item.voidReason}` : item.reason}</td>
                  {admin && (
                    <td>
                      {item.type === 'Entrada' && !item.voidedAt && (
                        <div className="row-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setError('')
                              setCorrecting(item)
                            }}
                          >
                            Corrigir
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => reversePurchase(item)}
                          >
                            Estornar
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!loading && !loadError && shown.length === 0 && (
            <EmptyState
              icon={ClipboardList}
              title={
                hasFilters
                  ? 'Nenhum resultado com estes filtros'
                  : 'Nenhuma movimentação registrada'
              }
              text={
                hasFilters
                  ? 'Altere ou limpe os filtros para ampliar a busca.'
                  : 'Registre uma entrada, saída ou ajuste para iniciar o histórico.'
              }
            />
          )}
          {loading && (
            <p className="table-loading" role="status">
              Carregando movimentações…
            </p>
          )}
        </div>
        <div className="table-footer">
          <span>
            Exibindo {shown.length ? (page - 1) * result.limit + 1 : 0}–
            {Math.min(page * result.limit, result.total)} de {result.total}
          </span>
          <div className="table-pagination">
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
      {correcting && (
        <PurchaseCorrectionModal
          entry={correcting}
          suppliers={suppliers}
          products={products}
          onClose={() => setCorrecting(null)}
          onSaved={async () => {
            setCorrecting(null)
            await refreshList()
          }}
        />
      )}
    </>
  )
}

function PurchaseCorrectionModal({ entry, suppliers, products, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(String(entry.purchaseQuantity ?? entry.quantity))
  const [supplierId, setSupplierId] = useState(String(entry.supplierId ?? ''))
  const [unitCost, setUnitCost] = useState(String(entry.purchaseUnitCost ?? entry.unitCost ?? ''))
  const [unitSalePrice, setUnitSalePrice] = useState(String(entry.unitSalePrice ?? ''))
  const [occurredAt, setOccurredAt] = useState(dateInput(entry.date))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const product = products.find((item) => String(item.id) === String(entry.productId))
  const conversion = Number(entry.purchaseConversion) || 1
  const correctedUnits = (Number(quantity) || 0) * conversion
  const projectedStock = Number(product?.stock ?? 0) + correctedUnits - Number(entry.quantity)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(
        `/movements/${entry.id}`,
        json('PATCH', {
          quantity: Number(quantity),
          supplierId: Number(supplierId),
          unitCost: Number(unitCost),
          unitSalePrice: Number(unitSalePrice),
          occurredAt,
          reason,
        }),
      )
      await onSaved()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <ModalDialog
        className="modal-card entity-modal-card"
        label="Corrigir compra"
        onClose={onClose}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">CORREÇÃO AUDITÁVEL</span>
            <h2>Corrigir compra</h2>
            <p>As quantidades e custos serão recalculados na ordem FIFO.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          <aside className="correction-impact">
            <span>Saldo do produto</span>
            <strong>
              {product?.stock ?? '—'} → {product ? projectedStock : '—'}{' '}
              {product?.unit?.toLowerCase() ?? ''}
            </strong>
            <small>
              A correção troca a quantidade deste lote ({correctedUnits}{' '}
              {product?.unit?.toLowerCase() ?? 'unidades'} convertidas). O servidor também verifica
              se as saídas registradas continuam cobertas.
            </small>
          </aside>
          <div className="form-grid">
            <Field
              label={`Quantidade recebida (${entry.purchaseUnit ?? entry.unit ?? 'unidade'})`}
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
            <div className="field-group">
              <label className="field-label">Fornecedor</label>
              <select
                className="form-control"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                required
              >
                <option value="">Selecione</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <Field
              label={`Custo por ${entry.purchaseUnit ?? 'medida de compra'} (R$)`}
              type="number"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              required
            />
            <Field
              label={`Preço de venda por ${entry.unit ?? 'unidade'} (R$)`}
              type="number"
              min="0.01"
              step="0.01"
              value={unitSalePrice}
              onChange={(event) => setUnitSalePrice(event.target.value)}
              required
            />
          </div>
          <Field
            label="Data da compra"
            type="date"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            required
          />
          <Field
            label="Motivo da correção"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength="500"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar correção'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  )
}

function Alerts({ products, go, admin }) {
  const hasProducts = products.length > 0
  const summary = hasProducts
    ? `${products.length} ${products.length === 1 ? 'produto precisa' : 'produtos precisam'} de reposição`
    : 'Inventário ainda não cadastrado'
  const summaryHelp = hasProducts
    ? 'Revise os saldos e planeje a próxima compra.'
    : 'Sem produtos cadastrados, ainda não é possível avaliar o estoque.'
  return (
    <>
      <PageHeading
        eyebrow="CONTROLE DE ESTOQUE"
        title="Estoque baixo"
        subtitle="Produtos que atingiram ou ficaram abaixo da quantidade mínima."
      />
      <div className="alert-summary">
        <span className="alert-summary-icon">
          <AlertTriangle size={20} />
        </span>
        <span>
          <strong>{summary}</strong>
          <small>{summaryHelp}</small>
        </span>
      </div>
      <div className="panel list-panel">
        <div className="panel-heading">
          <div>
            <h2>Itens para conferir</h2>
            <p>O alerta é atualizado com base nos saldos atuais.</p>
          </div>
        </div>
        {hasProducts ? (
          <div
            className="table-scroll"
            role="region"
            aria-label="Tabela com rolagem horizontal"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Saldo atual</th>
                  <th>Estoque mínimo</th>
                  <th>Diferença</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="cell-subtext">{item.code}</small>
                    </td>
                    <td>{item.category}</td>
                    <td>
                      <strong className="stock-low">
                        {item.stock} {item.unit.toLowerCase()}
                      </strong>
                    </td>
                    <td>
                      {item.minimum} {item.unit.toLowerCase()}
                    </td>
                    <td>
                      <strong className="stock-low">{item.minimum - item.stock} abaixo</strong>
                    </td>
                    <td>
                      <button className="text-button" onClick={go}>
                        Ver estoque <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Package}
            title="Aguardando inventário"
            text={
              admin
                ? 'Cadastre os produtos com os saldos contados para ativar os alertas.'
                : 'Os alertas aparecerão após o cadastro dos produtos pelo administrador.'
            }
          />
        )}
      </div>
    </>
  )
}

function ProductHistoryModal({ product, onClose }) {
  const [entries, setEntries] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    api(`/products/${product.id}/entries`)
      .then((result) => active && setEntries(result))
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [product.id])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal-card product-history-modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">HISTÓRICO DO PRODUTO</span>
            <h2>{product.name}</h2>
            <p>{product.code} · Compras, fornecedores, lotes restantes e valores informados.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <EmptyState
            icon={History}
            title="Carregando histórico"
            text="Consultando entradas registradas."
          />
        ) : entries.length ? (
          <div className="table-scroll history-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Quantidade</th>
                  <th>Restante do lote</th>
                  <th>Fornecedor</th>
                  <th>Custo unitário</th>
                  <th>Preço de venda</th>
                  <th>Total da compra</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {dateTime(entry.date)}
                      {entry.voidedAt && <small className="cell-subtext">Estornada</small>}
                    </td>
                    <td>{entry.quantity}</td>
                    <td>{entry.voidedAt ? '—' : (entry.quantityRemaining ?? '—')}</td>
                    <td>{entry.supplier || 'Não informado'}</td>
                    <td>{entry.unitCost == null ? 'Custo pendente' : money(entry.unitCost)}</td>
                    <td>{entry.unitSalePrice == null ? '—' : money(entry.unitSalePrice)}</td>
                    <td>{entry.totalCost == null ? '—' : money(entry.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !error && (
            <EmptyState
              icon={History}
              title="Nenhuma entrada registrada"
              text="As próximas entradas aparecerão aqui."
            />
          )
        )}
        <div className="history-note">
          FIFO significa “primeiro que entra, primeiro que sai”: as saídas consomem primeiro o lote
          mais antigo. O custo da saída e a margem usam essa ordem; custo pendente não é tratado
          como zero.
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </section>
    </div>
  )
}

function ProductSupplierPricesModal({ product, onClose }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api(`/products/${product.id}/suppliers`)
      .then((rows) => active && setSuppliers(rows))
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [product.id, reload])

  const purchaseCosts = suppliers
    .map((item) => item.lastPurchaseCost)
    .filter((value) => value != null)
    .map(Number)
  const quotePrices = suppliers
    .map((item) => item.lastQuotePrice)
    .filter((value) => value != null)
    .map(Number)
  const bestPurchase = purchaseCosts.length ? Math.min(...purchaseCosts) : null
  const bestQuote = quotePrices.length ? Math.min(...quotePrices) : null
  const showDate = (value) =>
    value
      ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
          new Date(`${String(value).slice(0, 10)}T12:00:00`),
        )
      : 'Sem registro'

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal-card product-supplier-prices-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-suppliers-title"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">FORNECEDORES DO PRODUTO</span>
            <h2 id="product-suppliers-title">{product.name}</h2>
            <p>{product.code} · Compare a última compra real e a cotação mais recente.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="product-price-highlights">
          <article>
            <span>Menor custo de compra recente</span>
            <strong>
              {bestPurchase == null ? 'Sem compras registradas' : money(bestPurchase)}
            </strong>
            <small>Considera entradas reais; cotações não entram neste cálculo.</small>
          </article>
          <article>
            <span>Menor cotação registrada</span>
            <strong>{bestQuote == null ? 'Sem cotações registradas' : money(bestQuote)}</strong>
            <small>Preço informado pelo fornecedor; não altera o estoque.</small>
          </article>
        </div>
        {error && (
          <div className="report-load-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setReload((value) => value + 1)}>
              Tentar novamente
            </button>
          </div>
        )}
        {loading ? (
          <EmptyState
            icon={Store}
            title="Consultando fornecedores"
            text="Buscando compras e cotações vinculadas a este produto."
          />
        ) : suppliers.length ? (
          <div className="product-supplier-price-list">
            {suppliers.map((item) => {
              const isBestPurchase =
                item.lastPurchaseCost != null && Number(item.lastPurchaseCost) === bestPurchase
              const isBestQuote =
                item.lastQuotePrice != null && Number(item.lastQuotePrice) === bestQuote
              return (
                <article className="product-supplier-price-row" key={item.supplierId}>
                  <div className="product-supplier-name">
                    <strong>{item.supplier}</strong>
                    <span
                      className={`status-pill ${item.supplierActive ? 'status-active' : 'status-warning'}`}
                    >
                      <i />
                      {item.supplierActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div
                    className={
                      isBestPurchase
                        ? 'product-supplier-value is-best-value'
                        : 'product-supplier-value'
                    }
                  >
                    <small>Última compra · {showDate(item.lastPurchaseDate)}</small>
                    <strong>
                      {item.lastPurchaseDate
                        ? item.lastPurchaseCost == null
                          ? 'Custo pendente'
                          : money(item.lastPurchaseCost)
                        : 'Sem compra registrada'}
                    </strong>
                    {item.lastPurchaseDate && (
                      <span>{item.lastPurchaseQuantity} unidade(s) recebida(s)</span>
                    )}
                    {isBestPurchase && <em>Menor compra recente</em>}
                  </div>
                  <div
                    className={
                      isBestQuote
                        ? 'product-supplier-value is-best-value'
                        : 'product-supplier-value'
                    }
                  >
                    <small>Última cotação · {showDate(item.lastQuoteDate)}</small>
                    <strong>
                      {item.lastQuotePrice == null ? 'Sem cotação' : money(item.lastQuotePrice)}
                    </strong>
                    {isBestQuote && <em>Menor cotação</em>}
                  </div>
                  <div className="product-supplier-history-grid">
                    <section>
                      <h3>
                        Histórico de compras <span>{item.purchases?.length ?? 0}</span>
                      </h3>
                      {item.purchases?.length ? (
                        <ul>
                          {item.purchases.map((purchase) => (
                            <li key={purchase.id}>
                              <span>
                                {showDate(purchase.date)} · {purchase.quantity} unidade(s)
                                {purchase.voidedAt ? ' · estornada' : ''}
                              </span>
                              <strong>
                                {purchase.unitCost == null
                                  ? 'Custo pendente'
                                  : money(purchase.unitCost)}
                              </strong>
                              {purchase.voidReason && (
                                <small>Motivo do estorno: {purchase.voidReason}</small>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Nenhuma compra registrada para este fornecedor.</p>
                      )}
                    </section>
                    <section>
                      <h3>
                        Histórico de cotações <span>{item.quotes?.length ?? 0}</span>
                      </h3>
                      {item.quotes?.length ? (
                        <ul>
                          {item.quotes.map((quote) => (
                            <li key={quote.id}>
                              <span>
                                {showDate(quote.date)}
                                {quote.note ? ` · ${quote.note}` : ''}
                              </span>
                              <strong>{money(quote.unitPrice)}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Nenhuma cotação registrada para este fornecedor.</p>
                      )}
                    </section>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={Truck}
            title="Nenhum fornecedor vinculado"
            text="Abra a ficha de um fornecedor para vincular este produto."
          />
        )}
        <p className="product-price-note">
          <History size={14} /> O histórico completo de entradas, por fornecedor e lote, está no
          botão de histórico do produto.
        </p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </section>
    </div>
  )
}

function PendingCostModal({ product, onClose, onSubmit, busy }) {
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('Regularização do custo do saldo já existente')
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setError('')
    const result = await onSubmit({ unitCost: Number(unitCost), reason })
    if (result?.error) setError(result.error)
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal-card entity-modal-card pending-cost-modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">REGULARIZAÇÃO DE ESTOQUE</span>
            <h2>Informar custo pendente</h2>
            <p>
              {product.name} · {product.stock} {product.unit.toLowerCase()} em estoque
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="pending-cost-explanation">
            <strong>
              {product.unitsPendingCost ?? 0} unidade(s) sem custo em {product.lotsPendingCost ?? 0}{' '}
              lote(s)
            </strong>
            <p>
              O valor será aplicado aos lotes pendentes; quando houver uma compra vinculada, o
              histórico dela também será atualizado. O custo do saldo e os relatórios serão
              recalculados. Informe o custo por unidade de venda/estoque.
            </p>
          </div>
          <Field
            label={`Custo por ${product.unit.toLowerCase()} (R$)`}
            type="number"
            min="0"
            step="0.01"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            placeholder="Ex.: 5,00"
            required
          />
          <Field
            label="Motivo / origem do valor"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength="500"
            required
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" disabled={busy || unitCost === ''}>
              {busy ? 'Salvando…' : 'Salvar custo no sistema'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function Reports({ products, suppliers, onInformCost }) {
  const [period, setPeriod] = useState('30d')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [productId, setProductId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [comparePrevious, setComparePrevious] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [marginView, setMarginView] = useState('')
  const [detailProduct, setDetailProduct] = useState(null)
  const [detailPeriod, setDetailPeriod] = useState(period)
  const [detailPage, setDetailPage] = useState(1)
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const customRangeError =
    period === 'custom'
      ? !fromDate || !toDate
        ? 'Informe a data inicial e a data final para gerar o relatório.'
        : fromDate > toDate
          ? 'A data inicial não pode ser posterior à data final.'
          : ''
      : ''
  const reportRangeLabel =
    report?.range?.from && report?.range?.to
      ? `${reportDateLabel(report.range.from)} a ${reportDateLabel(report.range.to)}`
      : periodLabel(period, fromDate, toDate)

  useEffect(() => {
    let active = true
    setError('')
    setReport(null)
    if (customRangeError) {
      setError(customRangeError)
      setLoading(false)
      return () => {
        active = false
      }
    }
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (period === 'custom') {
      params.set('from', fromDate)
      params.set('to', toDate)
    }
    if (comparePrevious) params.set('compare', 'previous')
    if (productId) params.set('productId', productId)
    if (supplierId) params.set('supplierId', supplierId)
    api(`/reports?${params}`)
      .then((result) => active && setReport(result))
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [
    period,
    fromDate,
    toDate,
    customRangeError,
    productId,
    supplierId,
    comparePrevious,
    reload,
    products,
  ])

  useEffect(() => {
    if (!detailProduct) return
    let active = true
    setDetailLoading(true)
    setDetailError('')
    const params = new URLSearchParams({
      period: detailPeriod,
      page: String(detailPage),
      limit: '25',
    })
    if (detailPeriod === 'custom') {
      params.set('from', fromDate)
      params.set('to', toDate)
    }
    if (supplierId) params.set('supplierId', supplierId)
    api(`/reports/product/${detailProduct.productId}/movements?${params}`)
      .then((result) => active && setDetailData(result))
      .catch((cause) => active && setDetailError(cause.message))
      .finally(() => active && setDetailLoading(false))
    return () => {
      active = false
    }
  }, [detailProduct, detailPeriod, detailPage, supplierId, fromDate, toDate])

  function openMargin(view) {
    setMarginView(view)
    setDetailProduct(null)
    setDetailPeriod(period)
    setDetailPage(1)
    setDetailData(null)
  }

  function showProduct(item) {
    setDetailProduct(item)
    setDetailPeriod(period)
    setDetailPage(1)
    setDetailData(null)
  }

  function closeMargin() {
    setMarginView('')
    setDetailProduct(null)
    setDetailData(null)
  }

  async function exportCsv() {
    if (!report) return
    setExporting(true)
    setExportError('')
    let writable = null
    try {
      const params = new URLSearchParams({ period, page: '1', limit: '100' })
      if (period === 'custom') {
        params.set('from', fromDate)
        params.set('to', toDate)
      }
      if (productId) params.set('productId', productId)
      if (supplierId) params.set('supplierId', supplierId)
      const decimal = (value) =>
        Number(value).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      const encodeRows = (rows) =>
        rows
          .map((row) =>
            row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';'),
          )
          .join('\r\n')
      const headerRows = [
        ['Período consultado', reportRangeLabel],
        [],
        [
          'Produto',
          'Código',
          'Categoria',
          'Saldo atual',
          'Mínimo',
          'Preço de venda unitário',
          'Custo remanescente',
        ],
        ...report.products.map((item) => [
          item.name,
          item.code,
          item.category,
          item.stock,
          item.minimum,
          decimal(item.price),
          item.costPending
            ? 'Pendente'
            : item.remainingCost == null
              ? '—'
              : decimal(item.remainingCost),
        ]),
        [],
        ['Resumo financeiro do período', 'Valor'],
        ['Total comprado', decimal(report.summary.purchasedCost)],
        ['Custo das saídas FIFO', decimal(report.summary.outgoingCost)],
        ['Receita registrada', decimal(report.summary.recordedRevenue)],
        ['Margem realizada', decimal(report.summary.realizedMargin)],
        [
          'Custo do estoque remanescente',
          report.summary.costPending ? 'Pendente' : decimal(report.summary.remainingCost),
        ],
        [
          'Margem estimada do saldo',
          report.summary.costPending ? 'Pendente' : decimal(report.summary.forecastMargin),
        ],
        [],
        ['Movimentações do período'],
        [
          'Data',
          'Tipo',
          'Produto',
          'Código',
          'Fornecedor',
          'Quantidade movimentada',
          'Unidade de estoque',
          'Quantidade comprada',
          'Medida de compra',
          'Conversão para estoque',
          'Custo por medida de compra (R$)',
          'Custo por unidade de estoque (R$)',
          'Custo FIFO da saída (R$)',
          'Preço de venda (R$)',
          'Receita (R$)',
          'Margem da saída (R$)',
          'Responsável',
          'Observação',
        ],
      ]

      // O navegador só permite abrir o seletor a partir de uma ação do usuário.
      if (typeof window.showSaveFilePicker === 'function') {
        const file = await window.showSaveFilePicker({
          suggestedName: 'relatorio-de-estoque.csv',
          types: [{ description: 'Arquivo CSV', accept: { 'text/csv': ['.csv'] } }],
        })
        writable = await file.createWritable()
        await writable.write(`\uFEFF${encodeRows(headerRows)}\r\n`)
      }

      const fallbackChunks = writable ? null : [`\uFEFF${encodeRows(headerRows)}\r\n`]
      let page = 1
      let total = 0
      let fetched = 0
      do {
        params.set('page', String(page))
        const result = await api(`/reports/movements?${params}`)
        total = Number(result.total) || 0
        const rows = result.movements.map((item) => [
          dateTime(item.date),
          item.type,
          item.productName,
          item.productCode,
          item.supplier ?? '',
          item.quantity,
          item.unit,
          item.purchaseQuantity ?? '',
          item.purchaseUnit ?? '',
          item.purchaseConversion ?? '',
          item.purchaseUnitCost == null ? '' : decimal(item.purchaseUnitCost),
          item.unitCost == null ? '' : decimal(item.unitCost),
          item.type === 'Saída' ? decimal(item.fifoCost) : '',
          item.unitSalePrice == null ? '' : decimal(item.unitSalePrice),
          item.type === 'Saída' ? decimal(item.revenue) : '',
          item.type === 'Saída' ? decimal(Number(item.revenue) - Number(item.fifoCost)) : '',
          item.user,
          item.reason,
        ])
        if (!rows.length) break
        const chunk = `${fetched ? '\r\n' : ''}${encodeRows(rows)}`
        if (writable) await writable.write(chunk)
        else fallbackChunks.push(chunk)
        fetched += rows.length
        page += 1
      } while (fetched < total)

      if (writable) {
        await writable.close()
        writable = null
      } else {
        const url = URL.createObjectURL(
          new Blob(fallbackChunks, { type: 'text/csv;charset=utf-8' }),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = 'relatorio-de-estoque.csv'
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cause) {
      if (writable) await writable.abort().catch(() => {})
      if (cause.name !== 'AbortError')
        setExportError(`Não foi possível gerar o CSV: ${cause.message}`)
    } finally {
      setExporting(false)
    }
  }

  const summary = report?.summary ?? {
    entries: 0,
    exits: 0,
    adjustments: 0,
    unitsIn: 0,
    unitsOut: 0,
    entryCostTotal: 0,
    potentialSaleTotal: 0,
    potentialMargin: 0,
  }
  return (
    <>
      <PageHeading
        eyebrow="GESTÃO"
        title="Relatórios"
        subtitle={`Posição do estoque e movimentações · ${reportRangeLabel}.`}
        action
        actionLabel={exporting ? 'Gerando CSV…' : 'Exportar CSV'}
        actionIcon={Download}
        onAction={exportCsv}
        actionDisabled={exporting || !report}
      />
      {exportError && (
        <div className="report-load-error" role="alert">
          <span>{exportError}</span>
          <button type="button" className="text-button" onClick={exportCsv}>
            Tentar novamente
          </button>
        </div>
      )}
      <div className="report-toolbar">
        <span>Período das movimentações</span>
        <div className="filter-field">
          <select
            aria-label="Período das movimentações"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Mês atual</option>
            <option value="custom">Período personalizado</option>
          </select>
          <ChevronDown size={14} />
        </div>
        <span className="report-period-note">{reportRangeLabel}</span>
        <button
          type="button"
          className={`secondary-button report-compare-toggle ${comparePrevious ? 'is-selected' : ''}`}
          aria-pressed={comparePrevious}
          onClick={() => setComparePrevious((value) => !value)}
        >
          {comparePrevious ? 'Ocultar comparação' : 'Comparar período anterior'}
        </button>
        {period === 'custom' && (
          <div className="report-date-range">
            <label>
              <span>De</span>
              <input
                aria-label="Data inicial do relatório"
                type="date"
                className="form-control"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              <span>Até</span>
              <input
                aria-label="Data final do relatório"
                type="date"
                className="form-control"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="filter-field">
          <select
            aria-label="Filtrar relatório por produto"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Todos os produtos</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <div className="filter-field">
          <select
            aria-label="Filtrar relatório por fornecedor"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Todos os fornecedores</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
      <details className="report-explainer">
        <summary>Entenda os números: fórmulas e significados</summary>
        <div className="report-formulas">
          <article>
            <span className="report-formula-icon">📦</span>
            <div>
              <strong>Quantidade em estoque</strong>
              <code>Saldo inicial + entradas − saídas ± ajustes = saldo atual</code>
              <small>
                Conta unidades. O sinal do ajuste depende de ele aumentar ou reduzir o estoque.
              </small>
            </div>
          </article>
          <article>
            <span className="report-formula-icon">🧾</span>
            <div>
              <strong>Compras e custo</strong>
              <code>Quantidade recebida × custo unitário = valor da compra</code>
              <small>
                FIFO (*First In, First Out*) quer dizer “primeiro que entra, primeiro que sai”:
                lotes mais antigos são consumidos antes dos novos. Ex.: 10 un. a R$ 5 + 2 un. a R$ 8
                = R$ 66 de custo para uma saída de 12 un.
              </small>
            </div>
          </article>
          <article>
            <span className="report-formula-icon">💰</span>
            <div>
              <strong>Venda realizada</strong>
              <code>Receita das vendas − custo FIFO vendido = margem realizada</code>
              <small>
                Considera vendas efetivamente registradas; não é o valor de todo o estoque.
              </small>
            </div>
          </article>
          <article>
            <span className="report-formula-icon">📈</span>
            <div>
              <strong>Projeção do saldo</strong>
              <code>Saldo × preço de venda = venda estimada</code>
              <small>
                Venda estimada − custo conhecido dos lotes restantes = margem estimada. É uma
                projeção, não lucro já obtido.
              </small>
            </div>
          </article>
        </div>
        <div className="report-explainer-grid">
          <p>
            <strong>Período, produto e fornecedor</strong>Filtram operações e valores do relatório.
            A tabela de posição mostra o saldo atual.
          </p>
          <p>
            <strong>Entradas / saídas / ajustes</strong>Quantidade de operações e unidades
            recebidas, retiradas ou corrigidas.
          </p>
          <p>
            <strong>Receita registrada</strong>Quantidade vendida multiplicada pelo preço informado
            na saída.
          </p>
          <p>
            <strong>Custo do saldo</strong>Custo conhecido dos lotes ainda disponíveis. Unidade sem
            custo fica pendente.
          </p>
          <p>
            <strong>Margem estimada</strong>Usa apenas unidades restantes com custo conhecido; não
            representa venda realizada.
          </p>
          <p>
            <strong>Tabela de posição atual</strong>Exibe saldo, mínimo, preço de venda e custo dos
            lotes ainda disponíveis.
          </p>
        </div>
      </details>
      {error && (
        <div className="report-load-error" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => setReload((value) => value + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {loading && (
        <EmptyState
          icon={FileBarChart}
          title="Carregando relatório"
          text="Buscando as movimentações e os saldos."
        />
      )}
      {!loading && report && (
        <>
          {comparePrevious && report.comparison && (
            <ReportComparison
              currentRange={report.range}
              previous={report.comparison}
              current={summary}
            />
          )}
          <section className="report-metric-group" aria-labelledby="report-activity-title">
            <h2 id="report-activity-title">Movimentação e projeção do saldo</h2>
            <div className="stats-grid report-stats">
              <ReportStat
                label="Entradas"
                value={summary.entries}
                helper={`${summary.unitsIn} unidades recebidas`}
                icon={ArrowDownLeft}
                color="green"
              />
              <ReportStat
                label="Saídas"
                value={summary.exits}
                helper={`${summary.unitsOut} unidades retiradas`}
                icon={ArrowUpRight}
                color="violet"
              />
              <ReportStat
                label="Ajustes"
                value={summary.adjustments}
                helper="operações no período"
                icon={SlidersHorizontal}
                color="amber"
              />
              <ReportStat
                label="Venda estimada do saldo"
                value={money(
                  report.products.reduce((sum, item) => sum + item.stock * item.price, 0),
                )}
                helper="projeção ao preço de venda atual; não é receita realizada"
                icon={FileBarChart}
                color="blue"
              />
            </div>
          </section>
          <section className="report-metric-group" aria-labelledby="report-financial-title">
            <h2 id="report-financial-title">Compras, vendas e margens</h2>
            <div className="stats-grid report-financial-stats">
              <ReportStat
                label="Total comprado"
                value={money(summary.purchasedCost)}
                helper={`${summary.unitsPurchased ?? 0} unidades recebidas no período`}
                icon={ArrowDownLeft}
                color="amber"
              />
              <ReportStat
                label="Custo das saídas"
                value={money(summary.outgoingCost)}
                helper="custo real calculado por FIFO"
                icon={Package}
                color="violet"
              />
              <ReportStat
                label="Receita registrada"
                value={money(summary.recordedRevenue)}
                helper="saídas ao preço informado"
                icon={ArrowUpRight}
                color="green"
              />
              <ReportStat
                label="Margem realizada"
                value={money(summary.realizedMargin)}
                helper="Clique para ver vendas e resultado por produto"
                icon={FileBarChart}
                color="blue"
                onClick={() => openMargin('realized')}
              />
              <ReportStat
                label="Custo do estoque restante"
                value={summary.costPending ? 'Pendente' : money(summary.remainingCost)}
                helper={
                  summary.costPending
                    ? 'informe o custo pendente na tabela abaixo'
                    : 'custo dos lotes ainda disponíveis'
                }
                icon={Package}
                color="amber"
              />
              <ReportStat
                label="Margem estimada do saldo"
                value={summary.costPending ? 'Pendente' : money(summary.forecastMargin)}
                helper="Clique para detalhar unidades e projeção por produto"
                icon={FileBarChart}
                color="violet"
                onClick={() => openMargin('forecast')}
              />
            </div>
          </section>
          <ReportCharts summary={summary} periodLabel={reportRangeLabel} />
          {marginView && (
            <MarginReportModal
              mode={marginView}
              summary={summary}
              products={report.productMargins ?? []}
              period={period}
              fromDate={fromDate}
              toDate={toDate}
              detailProduct={detailProduct}
              detailData={detailData}
              detailLoading={detailLoading}
              detailError={detailError}
              detailPeriod={detailPeriod}
              detailPage={detailPage}
              supplierId={supplierId}
              productId={productId}
              registeredProductCount={report.products.length}
              onClose={closeMargin}
              onSelectProduct={showProduct}
              onBack={() => {
                setDetailProduct(null)
                setDetailData(null)
                setDetailPage(1)
              }}
              onDetailPeriodChange={(value) => {
                setDetailPeriod(value)
                setDetailPage(1)
              }}
              onDetailPageChange={setDetailPage}
              onRefresh={() => setReload((value) => value + 1)}
            />
          )}
          <div className="panel report-table">
            <div className="panel-heading">
              <div>
                <h2>Posição atual do estoque</h2>
                <p>Custo dos lotes que ainda estão disponíveis para venda</p>
              </div>
              <span className="report-period-note">Dados cadastrados</span>
            </div>
            <div
              className="table-scroll"
              role="region"
              aria-label="Tabela com rolagem horizontal"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Saldo</th>
                    <th>Mínimo</th>
                    <th>Preço de venda atual</th>
                    <th>Custo do saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small className="cell-subtext">{item.code}</small>
                      </td>
                      <td>
                        {item.stock} {item.unit.toLowerCase()}
                      </td>
                      <td>{item.minimum}</td>
                      <td>{money(item.price)}</td>
                      <td>
                        <strong>
                          {item.costPending
                            ? 'Pendente'
                            : item.remainingCost == null
                              ? '—'
                              : money(Number(item.remainingCost))}
                        </strong>
                        {item.costPending && (
                          <>
                            <small className="cell-subtext">
                              Há {item.unitsPendingCost ?? 0} unidade(s) sem custo informado.
                            </small>
                            <button
                              type="button"
                              className="text-button report-cost-action"
                              onClick={() => onInformCost(item.id)}
                            >
                              Informar custo
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.products.length && (
                <EmptyState
                  icon={Package}
                  title="Sem produtos cadastrados"
                  text="Cadastre produtos para compor a posição de estoque."
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function ReportComparison({ currentRange, previous, current }) {
  const metrics = [
    { label: 'Compras registradas', key: 'entries', format: (value) => `${value} compra(s)` },
    { label: 'Unidades recebidas', key: 'unitsIn', format: (value) => `${value} unidade(s)` },
    { label: 'Saídas registradas', key: 'exits', format: (value) => `${value} saída(s)` },
    { label: 'Unidades vendidas', key: 'unitsOut', format: (value) => `${value} unidade(s)` },
    { label: 'Valor comprado', key: 'purchasedCost', format: money },
    { label: 'Custo FIFO das saídas', key: 'outgoingCost', format: money },
    { label: 'Receita realizada', key: 'recordedRevenue', format: money },
    { label: 'Margem realizada', key: 'realizedMargin', format: money },
  ]
  return (
    <section className="panel report-comparison" aria-labelledby="report-comparison-title">
      <div className="panel-heading">
        <div>
          <h2 id="report-comparison-title">Comparação com o período anterior</h2>
          <p>
            {reportDateLabel(previous.range.from)} a {reportDateLabel(previous.range.to)} ·
            comparado com {reportDateLabel(currentRange.from)} a {reportDateLabel(currentRange.to)}
          </p>
        </div>
      </div>
      <div
        className="table-scroll"
        role="region"
        aria-label="Comparação de indicadores entre períodos"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Indicador</th>
              <th>Período atual</th>
              <th>Período anterior</th>
              <th>Variação</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const currentValue = Number(current?.[metric.key] ?? 0)
              const previousValue = Number(previous.summary?.[metric.key] ?? 0)
              const difference = currentValue - previousValue
              const formatter = metric.format
              return (
                <tr key={metric.key}>
                  <td>{metric.label}</td>
                  <td>{formatter(currentValue)}</td>
                  <td>{formatter(previousValue)}</td>
                  <td>
                    <strong>
                      {difference > 0 ? '+' : ''}
                      {formatter(difference)}
                    </strong>
                    <small className="cell-subtext">
                      {difference > 0 ? 'Aumentou' : difference < 0 ? 'Reduziu' : 'Sem variação'}
                    </small>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="report-comparison-note">
        A comparação usa períodos com a mesma duração. Valores de estoque e margem estimada são a
        posição atual e não entram nessa comparação.
      </p>
    </section>
  )
}

function ReportCharts({ summary, periodLabel: appliedPeriod }) {
  const charts = [
    {
      title: 'Movimentação no período',
      subtitle: 'Unidades recebidas e retiradas',
      formatValue: (value) => `${Number(value).toLocaleString('pt-BR')} un.`,
      items: [
        {
          label: 'Recebidas',
          value: summary.unitsPurchased ?? summary.unitsIn,
          color: 'var(--chart-1)',
        },
        { label: 'Retiradas', value: summary.unitsOut, color: 'var(--chart-2)' },
      ],
    },
    {
      title: 'Valores do período',
      subtitle: 'Compras, custo das saídas e vendas',
      formatValue: money,
      items: [
        { label: 'Total comprado', value: summary.purchasedCost, color: 'var(--chart-1)' },
        { label: 'Custo das saídas', value: summary.outgoingCost, color: 'var(--chart-3)' },
        { label: 'Receita registrada', value: summary.recordedRevenue, color: 'var(--chart-4)' },
        {
          label: 'Margem realizada',
          value: summary.realizedMargin,
          color: Number(summary.realizedMargin) < 0 ? 'var(--chart-negative)' : 'var(--chart-5)',
        },
      ],
    },
  ]
  return (
    <section className="report-charts" aria-label="Gráficos do relatório">
      {charts.map((chart) => {
        const data = chart.items.map((item) => ({
          label: item.label,
          value: Number(item.value) || 0,
          fill: item.color,
        }))
        const accessibleSummary = `${chart.title}, ${appliedPeriod}. ${data.map((item) => `${item.label}: ${chart.formatValue(item.value)}`).join('; ')}.`
        return (
          <article className="panel report-chart-panel" key={chart.title}>
            <div className="panel-heading">
              <div>
                <h2>{chart.title}</h2>
                <p>
                  {chart.subtitle} · {appliedPeriod}
                </p>
              </div>
            </div>
            <p className="sr-only" role="img" aria-label={accessibleSummary}>
              {accessibleSummary}
            </p>
            <div className="report-rechart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ top: 2, right: 18, left: 3, bottom: 2 }}
                  barSize={17}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--chart-muted)', fontSize: 10 }}
                    tickFormatter={(value) => chart.formatValue(value)}
                    domain={([min, max]) => [Math.min(0, min), Math.max(0, max)]}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    width={145}
                    tick={{ fill: 'var(--chart-muted)', fontSize: 10 }}
                  />
                  <Tooltip
                    content={<InventoryChartTooltip formatValue={chart.formatValue} />}
                    cursor={{ fill: 'var(--chart-hover)' }}
                  />
                  <Bar dataKey="value" name="Valor" radius={[0, 4, 4, 0]}>
                    {data.map((item) => (
                      <Cell key={item.label} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        )
      })}
    </section>
  )
}

function periodLabel(period, fromDate, toDate) {
  if (period === 'custom')
    return fromDate && toDate
      ? `${reportDateLabel(fromDate)} a ${reportDateLabel(toDate)}`
      : 'Período personalizado'
  return {
    '7d': 'Últimos 7 dias',
    '30d': 'Últimos 30 dias',
    month: 'Mês atual',
    all: 'Todo o histórico',
  }[period]
}
function ReportStat({ label, value, helper, icon: Icon, color, onClick }) {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`stat-card${onClick ? ' stat-card-action' : ''}`}
      onClick={onClick}
    >
      <div className={`stat-icon stat-${color}`}>
        <Icon size={19} />
      </div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-helper">{helper}</span>
    </Tag>
  )
}

function MarginReportModal({
  mode,
  summary,
  products,
  period,
  fromDate,
  toDate,
  detailProduct,
  detailData,
  detailLoading,
  detailError,
  detailPeriod,
  detailPage,
  supplierId,
  productId,
  registeredProductCount,
  onClose,
  onSelectProduct,
  onBack,
  onDetailPeriodChange,
  onDetailPageChange,
  onRefresh,
}) {
  const realized = mode === 'realized'
  const title = realized ? 'Margem realizada por produto' : 'Margem estimada do saldo'
  const contributing = products.filter((item) =>
    realized
      ? Number(item.unitsSold) > 0
      : Number(item.knownUnits) > 0 || Number(item.pendingUnits) > 0,
  )
  const units = contributing.reduce(
    (total, item) =>
      total +
      Number(realized ? item.unitsSold : Number(item.knownUnits) + Number(item.pendingUnits)),
    0,
  )
  const margin = realized ? Number(summary.realizedMargin) : Number(summary.forecastMargin)
  const detailTitle = detailProduct?.name ?? title
  const totalPages = detailData ? Math.max(1, Math.ceil(detailData.total / detailData.limit)) : 1
  return (
    <div
      className="modal-backdrop report-detail-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal-card report-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={detailTitle}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">RELATÓRIO POR PRODUTO</span>
            <h2>{detailProduct ? detailProduct.name : title}</h2>
            <p>
              {detailProduct
                ? `${detailProduct.code || 'Sem código'} · ${detailProduct.unit || 'unidade'} · ${periodLabel(detailPeriod, fromDate, toDate)}`
                : `${periodLabel(period, fromDate, toDate)}${supplierId ? ' · fornecedor filtrado' : ''}`}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        {detailProduct ? (
          <>
            <div className="report-detail-toolbar">
              <button type="button" className="secondary-button" onClick={onBack}>
                <ArrowDownLeft size={14} /> Voltar aos produtos
              </button>
              <label>
                Período{' '}
                <select
                  value={detailPeriod}
                  onChange={(event) => onDetailPeriodChange(event.target.value)}
                >
                  <option value={period}>{periodLabel(period, fromDate, toDate)}</option>
                  <option value="all">Todo o histórico</option>
                </select>
              </label>
            </div>
            <div className="report-detail-callout">
              <strong>Compras e vendas registradas</strong>
              <span>
                Compras mostram custo e fornecedor. Nas vendas, FIFO (“primeiro que entra, primeiro
                que sai”) usa primeiro o custo dos lotes mais antigos para calcular o lucro
                realizado. Ajustes e cotações ficam fora deste histórico.
              </span>
            </div>
            {detailError && (
              <div className="report-load-error" role="alert">
                {detailError}
              </div>
            )}
            {detailLoading ? (
              <EmptyState
                icon={FileBarChart}
                title="Carregando movimentações"
                text="Buscando o histórico deste produto."
              />
            ) : (
              <div className="table-scroll report-movements-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Fornecedor</th>
                      <th>Quantidade</th>
                      <th>Custo</th>
                      <th>Venda / receita</th>
                      <th>Lucro realizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailData?.movements ?? []).map((move) => {
                      const sale = move.type === 'Saída'
                      const cost = sale ? Number(move.fifoCost) : Number(move.total)
                      const revenue = sale ? Number(move.total) : null
                      const profit = sale ? revenue - cost : null
                      return (
                        <tr key={move.id}>
                          <td>{dateTime(move.date)}</td>
                          <td>
                            <MovementBadge type={move.type} />
                          </td>
                          <td>{move.supplier || (sale ? 'Consumo FIFO' : '—')}</td>
                          <td>
                            {Math.abs(Number(move.quantity))} {detailProduct.unit?.toLowerCase()}
                          </td>
                          <td>{money(cost)}</td>
                          <td>
                            {sale ? money(revenue) : `Venda unitária ${money(move.unitSalePrice)}`}
                          </td>
                          <td>
                            {sale ? (
                              <strong
                                className={profit < 0 ? 'quantity-negative' : 'quantity-positive'}
                              >
                                {money(profit)}
                              </strong>
                            ) : (
                              'Ainda não realizada'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!detailData?.movements?.length && (
                  <EmptyState
                    icon={History}
                    title="Nenhuma compra ou venda neste período"
                    text="Tente consultar todo o histórico ou outro período."
                  />
                )}
              </div>
            )}
            <div className="report-detail-pagination">
              <span>
                {detailData
                  ? `${detailData.total} movimentações · página ${detailPage} de ${totalPages}`
                  : ''}
              </span>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={detailPage <= 1 || detailLoading}
                  onClick={() => onDetailPageChange(detailPage - 1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={detailPage >= totalPages || detailLoading}
                  onClick={() => onDetailPageChange(detailPage + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="report-detail-summary">
              <article>
                <span>{realized ? 'Lucro já realizado' : 'Margem estimada'}</span>
                <strong className={margin < 0 ? 'quantity-negative' : ''}>
                  {!realized && summary.costPending ? 'Há custo pendente' : money(margin)}
                </strong>
                <small>
                  {realized
                    ? 'Receita menos o custo dos lotes mais antigos consumidos primeiro (FIFO)'
                    : 'Somente unidades com custo conhecido; não é venda realizada'}
                </small>
              </article>
              <article>
                <span>{realized ? 'Produtos com vendas' : 'Produtos com saldo'}</span>
                <strong>{contributing.length}</strong>
                <small>
                  {units}{' '}
                  {realized ? 'unidades vendidas' : 'unidades no saldo (inclui custo pendente)'}
                </small>
              </article>
            </div>
            {!realized && summary.costPending && (
              <p className="report-pending-note">
                Parte do saldo ainda não tem custo informado. Essas unidades aparecem sinalizadas e
                ficam fora do cálculo de margem estimada.
              </p>
            )}
            <div className="table-scroll report-product-margin-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    {realized ? (
                      <>
                        <th>Compras</th>
                        <th>Unid. compradas</th>
                        <th>Vendas</th>
                        <th>Unid. vendidas</th>
                        <th>Custo FIFO</th>
                        <th>Receita</th>
                        <th>Lucro</th>
                      </>
                    ) : (
                      <>
                        <th>Unid. com custo</th>
                        <th>Unid. pendentes</th>
                        <th>Custo do saldo</th>
                        <th>Venda estimada</th>
                        <th>Margem estimada</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {products.map((item) => {
                    const value = realized
                      ? Number(item.realizedMargin)
                      : Number(item.forecastMargin)
                    const hasData = realized
                      ? Number(item.unitsSold) > 0
                      : Number(item.knownUnits) + Number(item.pendingUnits) > 0
                    return (
                      <tr key={item.productId}>
                        <td>
                          <button
                            type="button"
                            className="report-product-open"
                            onClick={() => onSelectProduct(item)}
                          >
                            {item.name}
                            <small>
                              {item.code || 'Sem código'}
                              {item.active === false ? ' · Inativo' : ''} ·{' '}
                              {hasData ? 'Ver compras e vendas' : 'Sem movimentações no cálculo'}
                            </small>
                          </button>
                        </td>
                        {realized ? (
                          <>
                            <td>{item.purchaseCount}</td>
                            <td>
                              {item.unitsPurchased} {item.unit?.toLowerCase()}
                            </td>
                            <td>{item.saleCount}</td>
                            <td>
                              {item.unitsSold} {item.unit?.toLowerCase()}
                            </td>
                            <td>{money(item.fifoCost)}</td>
                            <td>{money(item.revenue)}</td>
                            <td>
                              <strong
                                className={value < 0 ? 'quantity-negative' : 'quantity-positive'}
                              >
                                {money(value)}
                              </strong>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              {item.knownUnits} {item.unit?.toLowerCase()}
                            </td>
                            <td>
                              {item.pendingUnits ? (
                                <strong className="report-pending-value">
                                  {item.pendingUnits} pendente(s)
                                </strong>
                              ) : (
                                '0'
                              )}
                            </td>
                            <td>{money(item.remainingCost)}</td>
                            <td>{money(item.forecastRevenue)}</td>
                            <td>
                              {item.costPending ? (
                                <span className="report-pending-value">
                                  Parcial · custo pendente
                                </span>
                              ) : (
                                <strong
                                  className={value < 0 ? 'quantity-negative' : 'quantity-positive'}
                                >
                                  {money(value)}
                                </strong>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!products.length &&
                (registeredProductCount > 0 ? (
                  <div className="report-detail-missing">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>O relatório não recebeu os detalhes dos produtos</strong>
                      <span>
                        Há {registeredProductCount} produto(s) cadastrado(s), mas a API não retornou
                        a lista para esta análise. Atualize os dados e tente novamente.
                      </span>
                    </div>
                    <button type="button" className="secondary-button" onClick={onRefresh}>
                      Atualizar relatório
                    </button>
                  </div>
                ) : productId || supplierId ? (
                  <EmptyState
                    icon={Package}
                    title="Nenhum resultado com estes filtros"
                    text="Não há produtos correspondentes ao produto ou fornecedor selecionado no cálculo."
                  />
                ) : (
                  <EmptyState
                    icon={Package}
                    title="Nenhum produto cadastrado"
                    text="Cadastre produtos para que eles apareçam nesta análise."
                  />
                ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

const auditDetailLabels = {
  type: 'Tipo',
  reason: 'Observação',
  fifoCost: 'Custo FIFO',
  quantity: 'Quantidade',
  unitCost: 'Custo unitário',
  salePrice: 'Preço de venda',
  unitSalePrice: 'Preço de venda',
  occurredAt: 'Data da movimentação',
  supplierId: 'Fornecedor',
  productId: 'Produto',
  name: 'Nome',
  code: 'Código',
  openingUnitCost: 'Custo de abertura',
  quotedAt: 'Data da cotação',
  unitPrice: 'Preço cotado',
  active: 'Situação',
}

function formatAuditValue(key, value, { products, suppliers }) {
  if (value == null || value === '') return 'Não informado'
  if (key === 'type')
    return { Entrada: 'Entrada', Saída: 'Saída', Ajuste: 'Ajuste' }[value] ?? value
  if (key === 'supplierId')
    return (
      suppliers.find((supplier) => String(supplier.id) === String(value))?.name ??
      `Fornecedor #${value}`
    )
  if (key === 'productId')
    return (
      products.find((product) => String(product.id) === String(value))?.name ?? `Produto #${value}`
    )
  if (
    ['fifoCost', 'unitCost', 'salePrice', 'unitSalePrice', 'unitPrice', 'openingUnitCost'].includes(
      key,
    )
  ) {
    const amount = Number(value)
    return Number.isFinite(amount) ? money(amount) : String(value)
  }
  if (['occurredAt', 'quotedAt'].includes(key)) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    const date = new Date(dateOnly ? `${value}T12:00:00` : value)
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: key === 'occurredAt' ? 'short' : undefined,
          timeZone: stockTimeZone,
        }).format(date)
  }
  if (key === 'active') return value ? 'Ativo' : 'Inativo'
  return String(value)
}

function Audit({ audit, products = [], suppliers = [] }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ events: [], total: 0, limit: 25 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ page: String(page), limit: '25' })
    if (query.trim()) params.set('search', query.trim())
    setLoading(true)
    setError('')
    api(`/audit/search?${params}`)
      .then((payload) => active && setResult(payload))
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [page, query, reload])
  const visible = result.events
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit))
  const entityNames = {
    product: 'Produto',
    produto: 'Produto',
    supplier: 'Fornecedor',
    fornecedor: 'Fornecedor',
    category: 'Categoria',
    categoria: 'Categoria',
    stock: 'Estoque',
    estoque: 'Movimentação de estoque',
    user: 'Usuário',
    usuario: 'Usuário',
  }
  function detailsFor(item) {
    return Object.entries(item.details ?? {}).filter(([key, value]) => {
      if (value == null || value === '') return false
      if (key === 'fifoCost' && Number(value) === 0 && item.details?.type !== 'Saída') return false
      return true
    })
  }
  function actionLabel(action) {
    if (/registrou movimenta/i.test(action)) return 'Registrou movimentação'
    return action ? `${action[0].toLocaleUpperCase('pt-BR')}${action.slice(1)}` : 'Ação registrada'
  }
  return (
    <>
      <PageHeading
        eyebrow="GESTÃO"
        title="Auditoria"
        subtitle="Registro de alterações e movimentações realizadas no sistema."
      />
      <div className="panel list-panel">
        <div className="list-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Filtrar auditoria"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Filtrar ação, usuário ou registro"
            />
          </div>
          <span className="results-count">{result.total} eventos</span>
        </div>
        {error && (
          <div className="report-load-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setReload((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        )}
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabela com rolagem horizontal"
          tabIndex={0}
        >
          <table className="audit-table">
            <thead>
              <tr>
                <th>Data e hora</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Registro</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const details = detailsFor(item)
                return (
                  <tr key={item.id}>
                    <td>{dateTime(item.date)}</td>
                    <td>{item.user}</td>
                    <td>{actionLabel(item.action)}</td>
                    <td>
                      {entityNames[item.entity] ?? item.entity}
                      {item.entityId ? ` #${item.entityId}` : ''}
                    </td>
                    <td>
                      <div className="audit-detail-list">
                        {details.map(([key, value]) => (
                          <span key={key}>
                            <strong>{auditDetailLabels[key] ?? key}</strong>
                            {formatAuditValue(key, value, { products, suppliers })}
                          </span>
                        ))}
                        {!details.length && <span>—</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && !error && !visible.length && (
            <EmptyState
              icon={ShieldCheck}
              title={query ? 'Nenhum evento encontrado' : 'Sem eventos de auditoria'}
              text={
                query
                  ? 'Revise o termo da busca e tente novamente.'
                  : 'As ações executadas pelos usuários serão registradas aqui.'
              }
            />
          )}
          {loading && (
            <p className="table-loading" role="status">
              Carregando auditoria…
            </p>
          )}
        </div>
        <div className="table-footer">
          <span>
            Exibindo {visible.length ? (page - 1) * result.limit + 1 : 0}–
            {Math.min(page * result.limit, result.total)} de {result.total}
          </span>
          <div className="table-pagination">
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Settings({ user, onSubmit, busy }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  function submit(event) {
    event.preventDefault()
    setError('')
    if (form.newPassword.length < 12) return setError('Use uma senha com pelo menos 12 caracteres.')
    if (passwordByteLength(form.newPassword) > 72)
      return setError(
        'A senha deve ter no máximo 72 bytes; reduza o tamanho ou evite caracteres multibyte.',
      )
    if (form.newPassword !== form.confirmPassword)
      return setError('A confirmação não corresponde à nova senha.')
    onSubmit({ currentPassword: form.currentPassword, newPassword: form.newPassword })
  }
  return (
    <>
      <PageHeading
        eyebrow="CONTA"
        title="Configurações"
        subtitle="Atualize sua senha quando quiser."
      />
      <div className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Alterar senha</h2>
            <p>Informe sua senha atual e escolha uma nova com pelo menos 12 caracteres.</p>
          </div>
        </div>
        <form className="settings-form" onSubmit={submit}>
          <p>
            <strong>{user.name}</strong> · {user.email} · {user.role}
          </p>
          <label className="field-label" htmlFor="current-password">
            Senha atual
          </label>
          <input
            className="form-control"
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            required
          />
          <label className="field-label" htmlFor="new-password">
            Nova senha
          </label>
          <input
            className="form-control"
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength="12"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            required
          />
          <label className="field-label" htmlFor="confirm-password">
            Confirme a nova senha
          </label>
          <input
            className="form-control"
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            required
          />
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy}>
            <ShieldCheck size={16} />
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>
      </div>
    </>
  )
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={21} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

function DialogAccessibilityManager() {
  useEffect(() => {
    const attached = new Map()
    const focusableSelector =
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    function syncDialogs() {
      const active = new Set(document.querySelectorAll('.modal-backdrop > section.modal-card'))
      active.forEach((dialog) => {
        if (dialog.dataset.dialogManaged === 'true' || attached.has(dialog)) return
        const previousFocus = document.activeElement
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.setAttribute(
          'aria-label',
          dialog.querySelector('h2')?.textContent?.trim() || 'Janela de diálogo',
        )
        dialog.tabIndex = -1
        const onKeyDown = (event) => {
          const topOverlay = [...document.querySelectorAll('.modal-backdrop')].at(-1)
          const topDialog = topOverlay
            ? [...topOverlay.querySelectorAll('section.modal-card')].at(-1)
            : null
          if (topDialog && topDialog !== dialog) return
          if (event.key === 'Escape') {
            event.preventDefault()
            dialog.querySelector('button[aria-label="Fechar"]')?.click()
            return
          }
          if (event.key !== 'Tab') return
          const items = [...dialog.querySelectorAll(focusableSelector)].filter(
            (element) => !element.closest('[aria-hidden="true"]'),
          )
          if (!items.length) {
            event.preventDefault()
            dialog.focus()
            return
          }
          if (
            event.shiftKey &&
            (document.activeElement === items[0] || document.activeElement === dialog)
          ) {
            event.preventDefault()
            items.at(-1).focus()
          } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
            event.preventDefault()
            items[0].focus()
          }
        }
        dialog.addEventListener('keydown', onKeyDown)
        attached.set(dialog, { previousFocus, onKeyDown })
        ;(dialog.querySelector(focusableSelector) || dialog).focus()
      })
      for (const [dialog, state] of attached) {
        if (active.has(dialog)) continue
        dialog.removeEventListener('keydown', state.onKeyDown)
        attached.delete(dialog)
        if (state.previousFocus instanceof HTMLElement && state.previousFocus.isConnected)
          state.previousFocus.focus()
      }
    }
    const observer = new MutationObserver(syncDialogs)
    observer.observe(document.body, { childList: true, subtree: true })
    syncDialogs()
    return () => {
      observer.disconnect()
      for (const [dialog, state] of attached) dialog.removeEventListener('keydown', state.onKeyDown)
    }
  }, [])
  return null
}

function ModalDialog({ className, label, onClose, children }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const focusable = () =>
      [
        ...(dialog?.querySelectorAll(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((element) => element.getAttribute('aria-hidden') !== 'true')
    const first = focusable()[0]
    ;(first ?? dialog)?.focus()
    function handleKeyDown(event) {
      const topOverlay = [...document.querySelectorAll('.modal-backdrop')].at(-1)
      const topDialog = topOverlay
        ? [...topOverlay.querySelectorAll('section.modal-card')].at(-1)
        : null
      if (topDialog && topDialog !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items.at(-1)
      if (
        event.shiftKey &&
        (document.activeElement === firstItem || document.activeElement === dialog)
      ) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return (
    <section
      ref={dialogRef}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-dialog-managed="true"
    >
      {children}
    </section>
  )
}

const productUnits = [
  'Unidade',
  'Pacote',
  'Caixa',
  'Fardo',
  'Dúzia',
  'Quilograma',
  'Grama',
  'Litro',
  'Mililitro',
  'Galão',
  'Bombona',
  'Frasco',
  'Saco',
  'Rolo',
  'Metro',
  'Par',
]

function EntityModal({ modal, data, onClose, onSubmit, onQuickCreate, busy }) {
  const { kind, item } = modal
  const movementProducts = Array.isArray(modal.allowedProductIds)
    ? data.products.filter((product) =>
        modal.allowedProductIds.some((id) => String(id) === String(product.id)),
      )
    : data.products
  const [form, setForm] = useState(() =>
    initialForm(kind, item, data, modal.productId, modal.supplierId, modal.allowedProductIds),
  )
  const [error, setError] = useState('')
  const [quickKind, setQuickKind] = useState('')
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const setMovementProduct = (event) => {
    const productId = event.target.value
    const product = data.products.find((entry) => String(entry.id) === String(productId))
    setForm((current) => ({
      ...current,
      productId,
      ...(modal.supplierId ? {} : { supplierId: product?.supplierId ?? '' }),
    }))
  }
  const setPhone = (event) =>
    setForm((current) => ({ ...current, contact: formatBrazilianPhone(event.target.value) }))
  const setImage = (file) => {
    if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      return setError('Escolha uma imagem JPEG, PNG ou WebP.')
    if (file && file.size > 5 * 1024 * 1024) return setError('A imagem deve ter no máximo 5 MB.')
    setError('')
    setForm((current) => ({ ...current, imageFile: file }))
  }
  const titles = {
    product: item ? 'Editar produto' : 'Novo produto',
    category: item ? 'Editar categoria' : 'Nova categoria',
    supplier: item ? 'Editar fornecedor' : 'Novo fornecedor',
    user: item ? 'Gerenciar usuário' : 'Novo usuário',
    movement:
      form.type === 'Entrada'
        ? 'Registrar compra'
        : form.type === 'Saída'
          ? 'Registrar saída'
          : 'Ajustar saldo',
  }
  const subtitles = {
    product: 'Identificação, medidas e preços do produto.',
    category: 'Nome e descrição da categoria.',
    supplier: 'Dados de contato do parceiro.',
    user: 'O usuário poderá alterar a senha em Configurações.',
    movement:
      form.type === 'Entrada'
        ? 'Informe o que chegou, de quem veio e os valores desta compra.'
        : form.type === 'Saída'
          ? 'A saída usa primeiro as unidades compradas há mais tempo (FIFO).'
          : 'Registre a diferença entre o saldo contado e o saldo atual.',
  }
  async function submit(event) {
    event.preventDefault()
    setError('')
    const submitValues = async (values) => {
      try {
        const result = await onSubmit(values)
        if (result === false || result?.error)
          setError(
            result.error ||
              'Não foi possível salvar. Confira o aviso exibido na tela e tente novamente.',
          )
      } catch (submitError) {
        setError(submitError.message || 'Não foi possível salvar. Tente novamente.')
      }
    }
    if (kind === 'product' && !form.categoryId)
      return setError('Selecione ou cadastre uma categoria para o produto.')
    const saleUnitValue = form.unit === '__outra__' ? form.unitCustom?.trim() : form.unit?.trim()
    if (kind === 'product' && (!saleUnitValue || !form.purchaseUnit?.trim()))
      return setError('Informe as medidas de venda e de compra do produto.')
    if (kind === 'product' && (saleUnitValue.length > 30 || form.purchaseUnit.trim().length > 30))
      return setError('Cada medida deve ter no máximo 30 caracteres.')
    if (
      kind === 'product' &&
      (!Number.isSafeInteger(Number(form.unitsPerPurchase)) || Number(form.unitsPerPurchase) < 1)
    )
      return setError('Informe quantas unidades de venda vêm em cada medida de compra.')
    if (
      kind === 'product' &&
      saleUnitValue === form.purchaseUnit &&
      Number(form.unitsPerPurchase) !== 1
    )
      return setError('Use conversão 1 quando as medidas de compra e venda forem iguais.')
    if (kind === 'movement' && !movementProducts.length)
      return setError(
        modal.supplierId
          ? 'Vincule um produto a este fornecedor antes de registrar a compra.'
          : 'Cadastre um produto antes de registrar movimentações.',
      )
    if (kind === 'user' && !item && passwordByteLength(form.password) > 72)
      return setError(
        'A senha deve ter no máximo 72 bytes; reduza o tamanho ou evite caracteres multibyte.',
      )
    if (kind === 'supplier') {
      const phoneDigits = form.contact.replace(/\D/g, '')
      if (phoneDigits && phoneDigits.length !== 10 && phoneDigits.length !== 11)
        return setError('Informe o telefone com DDD: 10 dígitos para fixo ou 11 para celular.')
    }
    if (
      kind === 'product' &&
      !item &&
      Number(form.initialStock) > 0 &&
      (!form.supplierId || form.entryCost === '' || form.price === '')
    )
      return setError(
        'Para cadastrar o saldo inicial, informe o fornecedor, o custo de entrada e o preço de venda.',
      )
    if (
      kind === 'product' &&
      !item &&
      Number(form.initialStock) > 0 &&
      Number(form.price) <
        Number((Number(form.entryCost) / Number(form.unitsPerPurchase || 1)).toFixed(2))
    )
      return setError(
        'O preço de venda não pode ficar abaixo do custo convertido para a unidade de venda.',
      )
    if (
      kind === 'product' &&
      item &&
      Number(form.price) > 0 &&
      Number(form.price) < Number(form.entryCost === '' ? (item.averageCost ?? 0) : form.entryCost)
    )
      return setError(
        `O preço de venda não pode ficar abaixo do custo médio de ${money(form.entryCost === '' ? item.averageCost : form.entryCost)}.`,
      )
    if (
      kind === 'movement' &&
      form.type === 'Entrada' &&
      (!form.supplierId || form.unitCost === '' || form.unitSalePrice === '')
    )
      return setError(
        'Para registrar uma compra, informe fornecedor, custo de entrada e preço de venda.',
      )
    if (kind === 'movement' && form.type === 'Saída' && form.unitSalePrice === '')
      return setError('Informe o preço de venda desta saída.')
    if (kind === 'product') {
      const payload = {
        ...form,
        unit: saleUnitValue,
        unitsPerPurchase: Number(form.unitsPerPurchase),
        categoryId: Number(form.categoryId),
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        minimum: Number(form.minimum),
        price: Number(form.price || 0),
        entryCost: form.entryCost === '' ? null : Number(form.entryCost),
      }
      if (!item) payload.initialStock = Number(form.initialStock)
      return submitValues(payload)
    }
    if (kind === 'movement') {
      const selectedProduct = data.products.find(
        (product) => Number(product.id) === Number(form.productId),
      )
      const unitSalePrice =
        form.type === 'Saída'
          ? Number(selectedProduct?.price ?? 0)
          : form.unitSalePrice === ''
            ? null
            : Number(form.unitSalePrice)
      return submitValues({
        ...form,
        productId: Number(form.productId),
        quantity: Number(form.quantity),
        adjustment: Number(form.adjustment),
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        unitCost: form.unitCost === '' ? null : Number(form.unitCost),
        unitSalePrice,
        occurredAt: form.occurredAt,
      })
    }
    if (kind === 'user')
      return submitValues(item ? { role: form.role, active: form.active === 'true' } : form)
    return submitValues(form)
  }
  async function saveQuick(values) {
    const result = await onQuickCreate(quickKind, values)
    if (!result || result.error) return result
    const key = quickKind === 'category' ? 'categoryId' : 'supplierId'
    setForm((current) => ({ ...current, [key]: result.id }))
    setQuickKind('')
    return result
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <ModalDialog className="modal-card entity-modal-card" label={titles[kind]} onClose={onClose}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">CADASTRO</span>
            <h2>{titles[kind]}</h2>
            <p>{subtitles[kind]}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          {kind === 'product' && (
            <>
              <div className="form-grid">
                <Field label="Código" value={form.code} onChange={set('code')} required />
                <div className="field-group">
                  <label className="field-label" htmlFor="product-unit">
                    Unidade de controle
                  </label>
                  <select
                    id="product-unit"
                    aria-label="Unidade do produto"
                    className="form-control"
                    value={productUnits.includes(form.unit) ? form.unit : '__outra__'}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        unit: event.target.value === '__outra__' ? '__outra__' : event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">Selecione a unidade</option>
                    {productUnits.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                    <option value="__outra__">Outra unidade…</option>
                  </select>
                  {form.unit === '__outra__' && (
                    <input
                      className="form-control unit-custom-input"
                      aria-label="Nome da unidade personalizada"
                      maxLength="30"
                      placeholder="Ex.: balde, bombona retornável"
                      value={form.unitCustom ?? ''}
                      onChange={set('unitCustom')}
                      required
                    />
                  )}
                  {!productUnits.includes(form.unit) && form.unit !== '__outra__' && (
                    <small className="field-hint">
                      Unidade atual: {form.unit}. Selecione outra para alterá-la.
                    </small>
                  )}
                  <small className="field-hint">
                    A quantidade e os alertas serão registrados nesta unidade.
                  </small>
                </div>
              </div>
              <Field label="Nome do produto" value={form.name} onChange={set('name')} required />
              <div className="form-grid">
                <div className="field-group">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="product-category">
                      Categoria
                    </label>
                    {!item && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setQuickKind('category')}
                      >
                        <Plus size={12} /> Criar categoria
                      </button>
                    )}
                  </div>
                  <select
                    id="product-category"
                    className="form-control"
                    value={form.categoryId}
                    onChange={set('categoryId')}
                    required
                  >
                    <option value="">Selecione</option>
                    {data.categories.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor="product-supplier">
                      Fornecedor principal
                    </label>
                    {!item && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setQuickKind('supplier')}
                      >
                        <Plus size={12} /> Criar fornecedor
                      </button>
                    )}
                  </div>
                  <select
                    id="product-supplier"
                    className="form-control"
                    value={form.supplierId}
                    onChange={set('supplierId')}
                  >
                    <option value="">Sem fornecedor principal</option>
                    {data.suppliers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-grid product-numbers-grid">
                <div className="field-with-hint">
                  <NumberField
                    label="Estoque mínimo"
                    value={form.minimum}
                    onChange={set('minimum')}
                  />
                  <small>
                    O alerta aparece quando o saldo chegar a este valor ou ficar abaixo.
                  </small>
                </div>
                {!item && (
                  <NumberField
                    label="Saldo inicial"
                    value={form.initialStock}
                    onChange={set('initialStock')}
                  />
                )}
              </div>
              <div className="form-grid product-numbers-grid">
                <NumberField
                  label="Custo de entrada (R$)"
                  value={form.entryCost}
                  onChange={set('entryCost')}
                  step="0.01"
                />
                <NumberField
                  label="Preço de venda (R$)"
                  value={form.price}
                  onChange={set('price')}
                  step="0.01"
                />
              </div>
              {!item && (
                <p className="field-hint">
                  O custo e o preço de venda serão registrados no histórico quando houver saldo
                  inicial maior que zero. Ambos são opcionais.
                </p>
              )}
              <ImageUploadField
                value={form.imageFile}
                currentUrl={item?.imageUrl}
                onChange={setImage}
                label="Imagem do produto"
              />
            </>
          )}
          {kind === 'product' && (
            <div className="form-grid product-measure-grid">
              <div className="field-group">
                <label className="field-label" htmlFor="purchase-unit">
                  Medida de compra
                </label>
                <input
                  id="purchase-unit"
                  className="form-control"
                  list="purchase-unit-options"
                  value={form.purchaseUnit}
                  onChange={set('purchaseUnit')}
                  placeholder="Ex.: fardo"
                  required
                />
                <datalist id="purchase-unit-options">
                  {productUnits.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
              </div>
              <NumberField
                label={`Quantas ${form.unit || 'unidades de venda'} vêm em cada ${form.purchaseUnit || 'medida de compra'}?`}
                value={form.unitsPerPurchase}
                onChange={set('unitsPerPurchase')}
                min="1"
                step="1"
                required
              />
              <p className="field-hint measure-conversion-hint">
                A medida escolhida acima no campo Unidade de controle será a medida de venda e a
                unidade usada no saldo.
              </p>
            </div>
          )}
          {kind === 'product' && item?.costPending && (
            <p className="field-hint">
              O custo do saldo está pendente. Preencha o campo de custo para informar a base das
              unidades sem custo. Se houver um lote de compra específico sem custo, corrija essa
              entrada em Movimentações.
            </p>
          )}
          {kind === 'product' && !item && Number(form.initialStock) > 0 && (
            <Field
              label="Data do saldo inicial"
              type="date"
              value={form.occurredAt}
              onChange={set('occurredAt')}
              required
            />
          )}
          {kind === 'category' && (
            <>
              <Field label="Nome" value={form.name} onChange={set('name')} required />
              <Field label="Descrição" value={form.description} onChange={set('description')} />
            </>
          )}
          {kind === 'supplier' && (
            <>
              <Field label="Nome" value={form.name} onChange={set('name')} required />
              <div className="form-grid">
                <Field
                  label="Telefone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="(85) 99999-9999"
                  maxLength="15"
                  value={form.contact}
                  onChange={setPhone}
                />
                <Field label="E-mail" type="email" value={form.email} onChange={set('email')} />
              </div>
              <ImageUploadField
                value={form.imageFile}
                currentUrl={item?.imageUrl}
                onChange={setImage}
                label="Imagem do fornecedor"
              />
            </>
          )}
          {kind === 'user' && !item && (
            <>
              <Field label="Nome" value={form.name} onChange={set('name')} required />
              <Field
                label="Usuário para login"
                value={form.username}
                onChange={set('username')}
                required
                minLength="3"
                maxLength="50"
                pattern="[A-Za-z0-9._-]+"
              />
              <Field
                label="E-mail"
                type="email"
                value={form.email}
                onChange={set('email')}
                required
              />
              <label className="field-label">Perfil</label>
              <select
                aria-label="Perfil do novo usuário"
                className="form-control"
                value={form.role}
                onChange={set('role')}
              >
                <option value="operator">Operador de Estoque</option>
                <option value="admin">Administrador</option>
              </select>
              <Field
                label="Senha de acesso (mínimo 12 caracteres)"
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                minLength="12"
              />
              {form.password.length > 0 && form.password.length < 12 && (
                <p className="form-error">A senha precisa ter pelo menos 12 caracteres.</p>
              )}
            </>
          )}
          {kind === 'user' && item && (
            <>
              <p>
                {item.name} · @{item.username} · {item.email}
              </p>
              <label className="field-label">Perfil</label>
              <select
                aria-label="Perfil do usuário"
                className="form-control"
                value={form.role}
                onChange={set('role')}
              >
                <option value="operator">Operador de Estoque</option>
                <option value="admin">Administrador</option>
              </select>
              <label className="field-label">Status</label>
              <select
                aria-label="Status do usuário"
                className="form-control"
                value={form.active}
                onChange={set('active')}
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
              <p>Ele pode gerenciar a própria senha em Configurações.</p>
            </>
          )}
          {kind === 'movement' && (
            <MovementForm
              form={form}
              data={data}
              products={movementProducts}
              set={set}
              setMovementProduct={setMovementProduct}
            />
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" disabled={busy}>
              <Check size={16} />
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </ModalDialog>
      {quickKind && (
        <EntityModal
          modal={{ kind: quickKind, item: null }}
          data={data}
          onClose={() => setQuickKind('')}
          onSubmit={saveQuick}
          busy={busy}
        />
      )}
    </div>
  )
}

function MovementForm({ form, data, products, set, setMovementProduct }) {
  const product = products.find((item) => String(item.id) === String(form.productId))
  const isPurchase = form.type === 'Entrada'
  const isSale = form.type === 'Saída'
  const quantity = Number(form.quantity) || 0
  const cost = Number(form.unitCost) || 0
  const salePrice = Number(form.unitSalePrice) || 0
  const purchaseFactor = Number(product?.unitsPerPurchase) || 1
  const stockQuantity = isPurchase ? quantity * purchaseFactor : quantity
  const purchaseTotal = quantity * cost
  const projectedSales = stockQuantity * salePrice
  const projectedMargin = projectedSales - purchaseTotal
  const [fifoPreview, setFifoPreview] = useState(null)
  const [fifoPreviewError, setFifoPreviewError] = useState('')
  useEffect(() => {
    if (!isSale || !product || quantity < 1) {
      setFifoPreview(null)
      setFifoPreviewError('')
      return undefined
    }
    let active = true
    setFifoPreview(null)
    setFifoPreviewError('')
    api(`/products/${product.id}/fifo-preview?quantity=${quantity}`)
      .then((preview) => active && setFifoPreview(preview))
      .catch((error) => active && setFifoPreviewError(error.message))
    return () => {
      active = false
    }
  }, [isSale, product?.id, quantity])

  return (
    <div className="movement-flow">
      <div className="movement-type-switch" role="group" aria-label="Tipo de operação">
        {[
          ['Entrada', 'Compra / entrada'],
          ['Saída', 'Saída'],
          ['Ajuste', 'Ajuste de saldo'],
        ].map(([type, label]) => (
          <button
            key={type}
            type="button"
            className={
              form.type === type ? 'movement-type-option is-selected' : 'movement-type-option'
            }
            aria-pressed={form.type === type}
            onClick={() => set('type')({ target: { value: type } })}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="movement-step">
        <div className="movement-step-heading">
          <span>1</span>
          <div>
            <strong>
              {isPurchase ? 'O que chegou e de quem?' : 'Qual produto será movimentado?'}
            </strong>
            <small>
              {isPurchase
                ? 'A compra será registrada no histórico do produto e do fornecedor.'
                : 'O saldo disponível aparece junto ao nome do produto.'}
            </small>
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="movement-product">
            Produto
          </label>
          <select
            id="movement-product"
            className="form-control"
            value={form.productId}
            onChange={setMovementProduct}
            required
          >
            <option value="">Selecione um produto</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · saldo atual: {item.stock} {item.unit?.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        {isPurchase && (
          <div className="field-group">
            <label className="field-label" htmlFor="movement-supplier">
              Fornecedor da compra
            </label>
            <select
              id="movement-supplier"
              className="form-control"
              value={form.supplierId}
              onChange={set('supplierId')}
              required
            >
              <option value="">Selecione quem forneceu</option>
              {data.suppliers
                .filter((option) => option.status !== 'Inativo')
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
            </select>
            <small className="field-hint">
              Esse vínculo alimenta automaticamente a ficha do fornecedor e a comparação de compras.
            </small>
          </div>
        )}
      </section>

      <section className="movement-step">
        <div className="movement-step-heading">
          <span>2</span>
          <div>
            <strong>
              {isPurchase
                ? 'Quantidade, valores e data'
                : form.type === 'Saída'
                  ? 'Quantidade e valor da venda'
                  : 'Informe a diferença contada'}
            </strong>
            <small>
              {isPurchase
                ? 'Os valores são unitários e ficam guardados neste lote.'
                : form.type === 'Saída'
                  ? 'O sistema calcula o custo usando os lotes mais antigos primeiro.'
                  : 'Use positivo para acrescentar ou negativo para retirar unidades.'}
            </small>
          </div>
        </div>
        {form.type === 'Ajuste' ? (
          <>
            {
              <NumberField
                label={`Variação no saldo (${product?.unit?.toLowerCase() ?? 'unidades'})`}
                value={form.adjustment}
                onChange={set('adjustment')}
                allowNegative
                required
              />
            }
            {Number(form.adjustment) > 0 && (
              <NumberField
                label={`Custo por ${product?.unit?.toLowerCase() ?? 'unidade'} acrescentada (R$)`}
                value={form.unitCost}
                onChange={set('unitCost')}
                min="0"
                step="0.01"
                required
              />
            )}
          </>
        ) : (
          <div className="field-group">
            <label className="field-label" htmlFor="movement-quantity">
              Quantidade{' '}
              {product
                ? `(${isPurchase ? product.purchaseUnit?.toLowerCase() : product.unit?.toLowerCase()})`
                : ''}
            </label>
            <input
              id="movement-quantity"
              className="form-control"
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={set('quantity')}
              placeholder="Ex.: 2"
              required
            />
            {isPurchase && product && (
              <small className="field-hint">
                {quantity || 0} {product.purchaseUnit?.toLowerCase()} equivalem a{' '}
                {(quantity || 0) * (Number(product.unitsPerPurchase) || 1)}{' '}
                {product.unit?.toLowerCase()}.
              </small>
            )}
          </div>
        )}
        {form.type === 'Ajuste' && Number(form.adjustment) > 0 && (
          <small className="field-hint">
            Para evitar custo pendente, todo acréscimo de saldo precisa ter custo por unidade
            informado.
          </small>
        )}
        {isPurchase && (
          <div className="form-grid movement-values-grid">
            <NumberField
              label={`Custo por ${product?.purchaseUnit?.toLowerCase() ?? 'medida de compra'} (R$)`}
              value={form.unitCost}
              onChange={set('unitCost')}
              step="0.01"
              min="0"
              placeholder="Ex.: 120,00"
              required
            />
            <NumberField
              label={`Preço de venda por ${product?.unit?.toLowerCase() ?? 'unidade de venda'} (R$)`}
              value={form.unitSalePrice}
              onChange={set('unitSalePrice')}
              step="0.01"
              min="0"
              placeholder="Ex.: 15,00"
              required
            />
          </div>
        )}
        {form.type === 'Saída' && (
          <div className={product?.costPending ? 'fifo-guidance is-warning' : 'fifo-guidance'}>
            <strong>
              {product?.costPending
                ? 'Custo pendente neste produto'
                : 'Como o custo da saída é calculado (FIFO)'}
            </strong>
            <p>
              {product?.costPending
                ? 'O administrador precisa informar o custo de abertura antes de registrar a saída.'
                : product?.nextFifoCost != null
                  ? `A próxima unidade sai do lote mais antigo, com custo de ${money(product.nextFifoCost)}. O custo total será calculado para a quantidade informada.`
                  : 'O sistema selecionará os lotes mais antigos e calculará o custo desta saída.'}
            </p>
            <small>
              FIFO vem do inglês <em>First In, First Out</em>: “primeiro que entra, primeiro que
              sai”. Ex.: saindo 12 unidades de lotes com 10 a R$ 5 e 10 a R$ 8, o custo será 10 × R$
              5 + 2 × R$ 8 = R$ 66.
            </small>
          </div>
        )}
        {isSale && quantity > 0 && (
          <aside
            className={`purchase-preview ${fifoPreview?.costPending || fifoPreviewError ? 'is-warning' : ''}`}
            aria-live="polite"
          >
            <div className="purchase-preview-heading">
              <span className="purchase-preview-icon">
                <Package size={17} />
              </span>
              <div>
                <strong>Prévia da saída por FIFO</strong>
                <small>As unidades mais antigas serão consumidas primeiro.</small>
              </div>
            </div>
            {fifoPreviewError ? (
              <p className="form-error" role="alert">
                Não foi possível calcular a prévia: {fifoPreviewError}
              </p>
            ) : !fifoPreview ? (
              <p className="table-loading" role="status">
                Calculando os lotes…
              </p>
            ) : (
              <>
                <div className="purchase-preview-stats">
                  <div>
                    <small>Quantidade solicitada</small>
                    <strong>
                      {quantity} {product?.unit?.toLowerCase()}
                    </strong>
                    <span>{fifoPreview.available} disponíveis</span>
                  </div>
                  <div>
                    <small>Custo FIFO da saída</small>
                    <strong>
                      {fifoPreview.costPending
                        ? 'Pendente'
                        : fifoPreview.sufficientStock
                          ? money(fifoPreview.cost)
                          : 'Saldo insuficiente'}
                    </strong>
                    <span>{fifoPreview.allocations.length} lote(s) considerados</span>
                  </div>
                  <div>
                    <small>Receita informada</small>
                    <strong>
                      {salePrice > 0 ? money(quantity * salePrice) : 'Informe o preço'}
                    </strong>
                    <span>Quantidade × preço de venda</span>
                  </div>
                </div>
                {fifoPreview.costPending && (
                  <p className="purchase-risk-note">
                    Há lote sem custo conhecido. Informe o custo pendente antes de registrar a
                    saída.
                  </p>
                )}
                {!fifoPreview.sufficientStock && (
                  <p className="purchase-risk-note">
                    A quantidade solicitada supera o saldo disponível.
                  </p>
                )}
                {fifoPreview.sufficientStock && !fifoPreview.costPending && salePrice > 0 && (
                  <p
                    className={
                      quantity * salePrice < fifoPreview.cost
                        ? 'purchase-risk-note'
                        : 'purchase-fifo-note'
                    }
                  >
                    {quantity * salePrice < fifoPreview.cost
                      ? 'O preço está abaixo do custo desses lotes. Revise o preço antes de salvar.'
                      : `Margem desta saída: ${money(quantity * salePrice - fifoPreview.cost)} (receita menos custo dos lotes consumidos).`}
                  </p>
                )}
                <ul className="fifo-allocation-list">
                  {fifoPreview.allocations.map((lot) => (
                    <li key={lot.id}>
                      <span>
                        {dateTime(lot.date)}
                        {lot.supplier ? ` · ${lot.supplier}` : ''}
                      </span>
                      <strong>
                        {lot.quantity} ×{' '}
                        {lot.unitCost == null ? 'custo pendente' : money(lot.unitCost)}
                      </strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
        {form.type !== 'Ajuste' && (
          <Field
            label={isPurchase ? 'Data em que a mercadoria chegou' : 'Data da saída'}
            type="date"
            value={form.occurredAt}
            onChange={set('occurredAt')}
            required
          />
        )}
      </section>

      {isPurchase && (
        <PackagePurchasePreview
          product={product}
          packages={quantity}
          cost={form.unitCost}
          purchaseTotal={purchaseTotal}
          projectedSales={projectedSales}
          projectedMargin={projectedMargin}
        />
      )}
      <Field
        label={isPurchase ? 'Observação da compra (opcional)' : 'Motivo ou observação (opcional)'}
        value={form.reason}
        onChange={set('reason')}
        placeholder={isPurchase ? 'Ex.: nota fiscal, condição ou detalhe da entrega' : ''}
      />
    </div>
  )
}

function PackagePurchasePreview({
  product,
  packages,
  cost,
  purchaseTotal,
  projectedSales,
  projectedMargin,
}) {
  const units = Number(product?.unitsPerPurchase) || 1
  const stockAfter = Number(product?.stock ?? 0) + packages * units
  const hasValues = cost !== '' && packages > 0
  return (
    <aside className="purchase-preview" aria-live="polite">
      <div className="purchase-preview-heading">
        <span className="purchase-preview-icon">
          <Package size={17} />
        </span>
        <div>
          <strong>Conferência da compra</strong>
          <small>O saldo será convertido para a medida de venda.</small>
        </div>
      </div>
      <div className="purchase-preview-stats">
        <div>
          <small>Saldo após entrada</small>
          <strong>
            {product && packages ? `${stockAfter} ${product.unit?.toLowerCase()}` : '—'}
          </strong>
          <span>
            {packages} {product?.purchaseUnit?.toLowerCase() ?? 'embalagem(ns)'} × {units}{' '}
            {product?.unit?.toLowerCase() ?? 'unidade(s)'}
          </span>
        </div>
        <div>
          <small>Total da compra</small>
          <strong>{hasValues ? money(purchaseTotal) : '—'}</strong>
          <span>
            {packages} {product?.purchaseUnit?.toLowerCase() ?? 'embalagem(ns)'} × {money(cost)} por
            medida
          </span>
        </div>
        <div>
          <small>Margem estimada do lote</small>
          <strong
            className={hasValues ? (projectedMargin < 0 ? 'is-negative' : 'is-positive') : ''}
          >
            {hasValues ? money(projectedMargin) : '—'}
          </strong>
          <span>
            {hasValues
              ? `${money(projectedSales)} em venda potencial − ${money(purchaseTotal)} de custo`
              : 'Informe quantidade e custos'}
          </span>
        </div>
      </div>
      {hasValues && projectedMargin < 0 && (
        <p className="purchase-risk-note">
          Atenção: o preço de venda informado está abaixo do custo convertido.
        </p>
      )}
      <p className="purchase-fifo-note">
        A compra registra o custo por {product?.purchaseUnit?.toLowerCase() ?? 'embalagem'} e o
        converte para {product?.unit?.toLowerCase() ?? 'a medida de venda'}. Nas saídas, o sistema
        usa primeiro o lote mais antigo (FIFO: “primeiro que entra, primeiro que sai”).
      </p>
    </aside>
  )
}

function PurchasePreview({
  product,
  quantity,
  cost,
  salePrice,
  purchaseTotal,
  projectedSales,
  projectedMargin,
}) {
  const hasValues = cost !== '' && salePrice !== '' && quantity > 0
  return (
    <aside className="purchase-preview" aria-live="polite">
      <div className="purchase-preview-heading">
        <span className="purchase-preview-icon">
          <Package size={17} />
        </span>
        <div>
          <strong>Conferência antes de salvar</strong>
          <small>Prévia deste lote; não representa venda realizada.</small>
        </div>
      </div>
      <div className="purchase-preview-stats">
        <div>
          <small>Saldo após entrada</small>
          <strong>
            {product && quantity
              ? `${Number(product.stock) + quantity} ${product.unit?.toLowerCase()}`
              : '—'}
          </strong>
          <span>
            {product
              ? `Hoje: ${product.stock} ${product.unit?.toLowerCase()}`
              : 'Selecione o produto'}
          </span>
        </div>
        <div>
          <small>Total da compra</small>
          <strong>{hasValues ? money(purchaseTotal) : '—'}</strong>
          <span>{quantity ? `${quantity} unidade(s) × custo` : 'Informe quantidade e custo'}</span>
        </div>
        <div>
          <small>Margem bruta projetada</small>
          <strong
            className={hasValues ? (projectedMargin < 0 ? 'is-negative' : 'is-positive') : ''}
          >
            {hasValues ? money(projectedMargin) : '—'}
          </strong>
          <span>
            {hasValues
              ? `${money(projectedSales)} em venda − ${money(purchaseTotal)} em custo`
              : 'Preencha os dois valores'}
          </span>
        </div>
      </div>
      {hasValues && projectedMargin < 0 && (
        <p className="purchase-risk-note">
          Atenção: o preço de venda informado está abaixo do custo deste lote.
        </p>
      )}
      <p className="purchase-fifo-note">
        Esta margem considera o custo da mercadoria deste lote. Taxas e impostos precisam entrar na
        formação do preço. FIFO significa “primeiro que entra, primeiro que sai”:{' '}
        {product?.costPending
          ? 'há unidades antigas sem custo conhecido; elas continuam identificadas como custo pendente.'
          : product?.stock > 0 && product?.nextFifoCost != null
            ? `a próxima saída começa pelo lote mais antigo, com custo de ${money(product.nextFifoCost)} por unidade.`
            : 'nas próximas saídas, os lotes serão consumidos do mais antigo para o mais novo.'}
      </p>
    </aside>
  )
}

function initialForm(kind, item, data, presetProductId, presetSupplierId, allowedProductIds) {
  if (kind === 'product') {
    const supplierId = item?.supplierId ?? presetSupplierId ?? ''
    const localToday = todayInStockZone()
    return item
      ? {
          code: item.code,
          name: item.name,
          categoryId: item.categoryId,
          supplierId,
          unit: item.unit,
          purchaseUnit: item.purchaseUnit ?? item.unit,
          unitsPerPurchase: item.unitsPerPurchase ?? 1,
          minimum: item.minimum,
          price: item.price,
          entryCost: '',
          imageFile: null,
        }
      : {
          code: '',
          name: '',
          categoryId: data.categories[0]?.id ?? '',
          supplierId,
          unit: 'Unidade',
          purchaseUnit: 'Unidade',
          unitsPerPurchase: 1,
          minimum: 0,
          price: '',
          entryCost: '',
          initialStock: 0,
          occurredAt: localToday,
          imageFile: null,
        }
  }
  if (kind === 'category') return { name: item?.name ?? '', description: item?.description ?? '' }
  if (kind === 'supplier')
    return {
      name: item?.name ?? '',
      contact: formatBrazilianPhone(item?.contact),
      email: item?.email ?? '',
      imageFile: null,
    }
  if (kind === 'user')
    return item
      ? {
          name: item.name,
          username: item.username,
          email: item.email,
          role: item.roleKey,
          active: String(item.status === 'Ativo'),
        }
      : { name: '', username: '', email: '', role: 'operator', password: '' }
  const availableProducts = Array.isArray(allowedProductIds)
    ? data.products.filter((product) =>
        allowedProductIds.some((id) => String(id) === String(product.id)),
      )
    : data.products
  const selectedProduct =
    availableProducts.find((product) => String(product.id) === String(presetProductId)) ||
    (Array.isArray(allowedProductIds) ? null : data.products[0])
  const localToday = todayInStockZone()
  return {
    type: 'Entrada',
    productId: selectedProduct?.id ?? '',
    quantity: '',
    adjustment: '',
    supplierId: presetSupplierId || selectedProduct?.supplierId || '',
    unitCost: '',
    unitSalePrice: selectedProduct?.price ?? '',
    occurredAt: localToday,
    reason: '',
  }
}
function ImageUploadField({ value, currentUrl, onChange, label }) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!value) {
      setPreview('')
      return undefined
    }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  return (
    <div className="image-field">
      <span className="field-label">{label}</span>
      <div className="image-field-control">
        {preview || currentUrl ? (
          <img src={preview || currentUrl} alt="Pré-visualização da imagem" />
        ) : (
          <span className="image-placeholder">
            <Package size={19} />
          </span>
        )}
        <label className="secondary-button image-picker">
          {value ? 'Trocar imagem' : currentUrl ? 'Substituir imagem' : 'Escolher imagem'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          />
        </label>
        <small>JPEG, PNG ou WebP · até 5 MB</small>
      </div>
    </div>
  )
}
function Field({ label, value, onChange, type = 'text', ...props }) {
  const id = useId()
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="form-control"
        type={type}
        value={value}
        onChange={onChange}
        {...props}
      />
    </div>
  )
}
function NumberField({ label, value, onChange, allowNegative = false, ...props }) {
  const id = useId()
  const visibleLabel =
    label === 'Custo de entrada (R$)' ? 'Custo de entrada / médio do saldo (R$)' : label
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {visibleLabel}
      </label>
      <input
        id={id}
        className="form-control"
        type="number"
        step="1"
        value={value}
        onChange={onChange}
        {...(allowNegative ? {} : { min: '0' })}
        {...props}
      />
    </div>
  )
}

export default App
