import { Link } from "raviger";

export interface NavTabItem {
  key: string;
  label: string;
  href: string;
}

interface NavTabsProps {
  tabs: NavTabItem[];
  currentTab: string;
  className?: string;
  tabTriggerClassName?: string;
}

export function NavTabs({
  tabs,
  currentTab,
  className = "",
  tabTriggerClassName = "",
}: NavTabsProps) {
  return (
    <div className={className}>
      <div className="w-full justify-evenly sm:justify-start border-b rounded-none bg-transparent p-0 h-auto overflow-x-auto flex flex-nowrap gap-2">
        {tabs.map((tab) => {
          const isActive = tab.key === currentTab;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`whitespace-nowrap border-b-3 px-1.5 sm:px-2.5 py-2 text-gray-600 font-semibold hover:text-gray-900 rounded-none ${
                isActive
                  ? "border-b-primary-700 text-primary-800 bg-transparent shadow-none"
                  : "border-transparent"
              } ${tabTriggerClassName}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
