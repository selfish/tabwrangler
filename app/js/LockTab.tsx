import * as React from "react";
import settings, { SETTINGS_DEFAULTS } from "./settings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppState } from "./Types";
import OpenTabRow from "./OpenTabRow";
import cx from "classnames";
import { isTabLocked } from "./tabUtil";
import { useSelector } from "react-redux";

type Sorter = {
  key: string;
  label: () => string;
  shortLabel: () => string;
  sort: (
    a: chrome.tabs.Tab | null,
    b: chrome.tabs.Tab | null,
    tabTimes: {
      [tabid: string]: number;
    }
  ) => number;
};

const ChronoSorter: Sorter = {
  key: "chrono",
  label: () => chrome.i18n.getMessage("tabLock_sort_timeUntilClose") || "",
  shortLabel: () => chrome.i18n.getMessage("tabLock_sort_timeUntilClose_short") || "",
  sort(tabA, tabB, tabTimes) {
    if (tabA == null || tabB == null) {
      return 0;
    } else if (settings.isTabLocked(tabA) && !settings.isTabLocked(tabB)) {
      return 1;
    } else if (!settings.isTabLocked(tabA) && settings.isTabLocked(tabB)) {
      return -1;
    } else {
      const lastModifiedA = tabA.id == null ? -1 : tabTimes[tabA.id];
      const lastModifiedB = tabB.id == null ? -1 : tabTimes[tabB.id];
      return lastModifiedA - lastModifiedB;
    }
  },
};

const ReverseChronoSorter: Sorter = {
  key: "reverseChrono",
  label: () => chrome.i18n.getMessage("tabLock_sort_timeUntilClose_desc") || "",
  shortLabel: () => chrome.i18n.getMessage("tabLock_sort_timeUntilClose_desc_short") || "",
  sort(tabA, tabB, tabTimes) {
    return -1 * ChronoSorter.sort(tabA, tabB, tabTimes);
  },
};

const TabOrderSorter: Sorter = {
  key: "tabOrder",
  label: () => chrome.i18n.getMessage("tabLock_sort_tabOrder") || "",
  shortLabel: () => chrome.i18n.getMessage("tabLock_sort_tabOrder_short") || "",
  sort(tabA, tabB) {
    if (tabA == null || tabB == null) {
      return 0;
    } else if (tabA.windowId === tabB.windowId) {
      return tabA.index - tabB.index;
    } else {
      return tabA.windowId - tabB.windowId;
    }
  },
};

const ReverseTabOrderSorter: Sorter = {
  key: "reverseTabOrder",
  label: () => chrome.i18n.getMessage("tabLock_sort_tabOrder_desc") || "",
  shortLabel: () => chrome.i18n.getMessage("tabLock_sort_tabOrder_desc_short") || "",
  sort(tabA, tabB, tabTimes) {
    return -1 * TabOrderSorter.sort(tabA, tabB, tabTimes);
  },
};

const DEFAULT_SORTER = TabOrderSorter;
const Sorters = [TabOrderSorter, ReverseTabOrderSorter, ChronoSorter, ReverseChronoSorter];

export default function LockTab() {
  const dropdownRef = React.useRef<HTMLElement | null>(null);
  const lastSelectedTabRef = React.useRef<chrome.tabs.Tab | null>(null);
  const queryClient = useQueryClient();
  const [isSortDropdownOpen, setIsSortDropdownOpen] = React.useState<boolean>(false);
  const [sortOrder, setSortOrder] = React.useState<string | null>(
    settings.get<string>("lockTabSortOrder")
  );
  const [currSorter, setCurrSorter] = React.useState(() => {
    let sorter = sortOrder == null ? DEFAULT_SORTER : Sorters.find((s) => s.key === sortOrder);

    // If settings somehow stores a bad value, always fall back to default order.
    if (sorter == null) sorter = DEFAULT_SORTER;
    return sorter;
  });
  const tabTimes = useSelector((state: AppState) => state.localStorage.tabTimes);
  const { data: tabs } = useQuery({ queryFn: () => chrome.tabs.query({}), queryKey: ["tabs"] });
  const sortedTabs = React.useMemo(
    () =>
      tabs == null ? [] : tabs.slice().sort((tabA, tabB) => currSorter.sort(tabA, tabB, tabTimes)),
    [currSorter, tabTimes, tabs]
  );
  const { data: tabLockData } = useQuery({
    queryFn: () => chrome.storage.sync.get(SETTINGS_DEFAULTS),
    queryKey: ["tabLock"],
  });
  React.useEffect(() => {
    function handleChanged(
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: chrome.storage.AreaName
    ) {
      if (
        areaName === "sync" &&
        ["filterAudio", "filterGroupedTabs", "lockedIds", "whitelist"].some((key) => key in changes)
      )
        queryClient.invalidateQueries({ queryKey: ["tabLock"] });
    }
    chrome.storage.onChanged.addListener(handleChanged);
    return () => {
      chrome.storage.onChanged.removeListener(handleChanged);
    };
  }, [queryClient]);

  const lockedTabIds = React.useMemo(
    () =>
      tabLockData == null
        ? new Set()
        : new Set(
            sortedTabs
              .filter((tab) =>
                isTabLocked(tab, {
                  filterAudio: tabLockData["filterAudio"],
                  filterGroupedTabs: tabLockData["filterGroupedTabs"],
                  lockedIds: tabLockData["lockedIds"],
                  whitelist: tabLockData["whitelist"],
                })
              )
              .map((tab) => tab.id)
          ),
    [sortedTabs, tabLockData]
  );

  React.useEffect(() => {
    function handleWindowClick(event: MouseEvent) {
      if (
        isSortDropdownOpen &&
        dropdownRef.current != null &&
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsSortDropdownOpen(false);
      }
    }

    window.addEventListener("click", handleWindowClick);
    return () => {
      window.removeEventListener("click", handleWindowClick);
    };
  }, [isSortDropdownOpen]);

  function clickSorter(nextSorter: Sorter, event: React.MouseEvent<HTMLElement>) {
    // The dropdown wraps items in bogus `<a href="#">` elements in order to match Bootstrap's
    // style. Prevent default on the event in order to prevent scrolling to the top of the window
    // (the default action for an empty anchor "#").
    event.preventDefault();

    if (nextSorter === currSorter) {
      // If this is already the active sorter, close the dropdown and do no work since the state is
      // already correct.
      setIsSortDropdownOpen(false);
    } else {
      // When the saved sort order is not null then the user wants to preserve it. Update to the
      // new sort order and persist it.
      if (settings.get("lockTabSortOrder") != null) {
        settings.set("lockTabSortOrder", nextSorter.key);
      }

      setIsSortDropdownOpen(false);
      setCurrSorter(nextSorter);
    }
  }

  function handleChangeSaveSortOrder(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.checked) {
      settings.set("lockTabSortOrder", currSorter.key);
      setSortOrder(currSorter.key);
    } else {
      settings.set("lockTabSortOrder", null);
      setSortOrder(null);
    }
  }

  function handleToggleTab(tab: chrome.tabs.Tab, selected: boolean, multiselect: boolean) {
    let tabsToToggle = [tab];
    if (multiselect && lastSelectedTabRef.current != null) {
      const lastSelectedTabIndex = sortedTabs.indexOf(lastSelectedTabRef.current);
      if (lastSelectedTabIndex >= 0) {
        const tabIndex = sortedTabs.indexOf(tab);
        tabsToToggle = sortedTabs.slice(
          Math.min(tabIndex, lastSelectedTabIndex),
          Math.max(tabIndex, lastSelectedTabIndex) + 1
        );
      }
    }

    // Toggle only the tabs that are manually lockable.
    tabsToToggle
      .filter((tab) => settings.isTabManuallyLockable(tab))
      .forEach((tab) => {
        if (tab.id == null) return;
        else if (selected) settings.lockTab(tab.id);
        else settings.unlockTab(tab.id);
      });

    lastSelectedTabRef.current = tab;
  }

  function toggleSortDropdown() {
    setIsSortDropdownOpen(!isSortDropdownOpen);
  }

  return (
    <div className="tab-pane active">
      <div className="d-flex align-items-center justify-content-between border-bottom pb-2">
        <div style={{ paddingLeft: "0.55rem", paddingRight: "0.55rem" }}>
          <abbr title={chrome.i18n.getMessage("tabLock_lockLabel")}>
            <i className="fas fa-lock" />
          </abbr>
        </div>
        <div
          className="dropdown"
          ref={(dropdown) => {
            dropdownRef.current = dropdown;
          }}
        >
          <button
            aria-haspopup="true"
            className="btn btn-outline-dark btn-sm"
            id="sort-dropdown"
            onClick={toggleSortDropdown}
            title={chrome.i18n.getMessage("corral_currentSort", currSorter.label())}
          >
            <span>{chrome.i18n.getMessage("corral_sortBy")}</span>
            <span> {currSorter.shortLabel()}</span> <i className="fas fa-caret-down" />
          </button>
          <div
            aria-labelledby="sort-dropdown"
            className={cx("dropdown-menu dropdown-menu-right shadow-sm", {
              show: isSortDropdownOpen,
            })}
          >
            {Sorters.map((sorter) => (
              <a
                className={cx("dropdown-item", { active: currSorter === sorter })}
                href="#"
                key={sorter.label()}
                onClick={(event) => {
                  clickSorter(sorter, event);
                }}
              >
                {sorter.label()}
              </a>
            ))}
            <div className="dropdown-divider" />
            <form className="px-4 pb-1">
              <div className="form-group mb-0">
                <div className="form-check">
                  <input
                    checked={sortOrder != null}
                    className="form-check-input"
                    id="lock-tab--save-sort-order"
                    onChange={handleChangeSaveSortOrder}
                    type="checkbox"
                  />
                  <label className="form-check-label" htmlFor="lock-tab--save-sort-order">
                    {chrome.i18n.getMessage("options_option_saveSortOrder")}
                  </label>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
      <table className="table table-hover table-sm table-th-unbordered">
        <tbody>
          {sortedTabs.map((tab) => (
            <OpenTabRow
              isLocked={lockedTabIds.has(tab.id)}
              key={tab.id}
              onToggleTab={handleToggleTab}
              tab={tab}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
