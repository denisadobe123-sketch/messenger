import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-icon">⚠️</div>
        <h2>Что-то пошло не так</h2>
        <p>Приложение столкнулось с ошибкой. Попробуй перезагрузить.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </div>
    );
  }
}
