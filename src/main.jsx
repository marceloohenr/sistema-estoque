import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './overrides.css'

class ScreenErrorBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Falha ao renderizar a tela:', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="screen-error-page" role="alert">
          <section>
            <h1>Não foi possível abrir esta tela</h1>
            <p>Ocorreu um erro ao abrir a tela. Tente novamente.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => this.setState({ failed: false })}
            >
              Tentar novamente
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ScreenErrorBoundary>
      <App />
    </ScreenErrorBoundary>
  </React.StrictMode>,
)
