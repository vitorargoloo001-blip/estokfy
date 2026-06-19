import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';

export default function TopBar() {
  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-8 mb-4 flex items-center justify-between gap-2 border-b bg-background/80 backdrop-blur px-4 md:px-8 py-2">
      <GlobalSearch />
      <div className="flex items-center gap-1">
        <NotificationBell />
      </div>
    </div>
  );
}
