"use client";

import DeviceSettings from "@/shared/components/DeviceSettings";
import { SidebarResizer } from "@/components/SidebarResizer";

export default function RightSidebar() {
  return (
    <aside className="rightbar">
      <SidebarResizer
        side="left"
        cssVar="--sidebar-right-width"
        storeKey="sidebarRightWidth"
      />
      <div className="panel">
        <h3>Device Settings</h3>
        <DeviceSettings />
      </div>
    </aside>
  );
}

