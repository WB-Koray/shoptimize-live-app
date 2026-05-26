import { Component } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg p-6">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-roseSoft flex items-center justify-center mx-auto">
              <AlertCircle size={24} className="text-rose" />
            </div>
            <h2 className="text-text font-bold text-lg">Beklenmedik bir hata oluştu</h2>
            <p className="text-textMute text-sm">
              {this.state.error?.message || 'Uygulama yüklenemedi.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl bg-surface border border-border text-text text-sm font-semibold hover:border-green/50 transition-colors"
            >
              <RefreshCw size={14} /> Yeniden Yükle
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
