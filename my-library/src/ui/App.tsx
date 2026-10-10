import { Library } from './components/Library';
import { Player } from './components/Player';
import { SettingsPage } from './components/SettingsPage';
import { UpdatePrompt } from './components/UpdatePrompt';
import { speechEngine } from './engine';
import { SettingsProvider } from './hooks/settings';
import { ToastProvider } from './hooks/toast';
import { useRoute } from './hooks/useRoute';

export function App() {
  const route = useRoute();
  return (
    <ToastProvider>
      <SettingsProvider>
        <UpdatePrompt />
        {!speechEngine.isSupported() && (
          <div className="banner warn" style={{ margin: 12 }}>
            <div className="banner-body">
              <strong>Speech is not available in this browser.</strong> You can still import and read books. Use Safari on iPhone, or Chrome,
              Edge or Safari on a computer, to listen.
            </div>
          </div>
        )}
        {route.name === 'library' && <Library />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'book' && <Player key={route.id} id={route.id} autoplay={route.autoplay} />}
      </SettingsProvider>
    </ToastProvider>
  );
}
