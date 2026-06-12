## 0.0.17

- Persist C4004 device data under the Home Assistant config folder via `config:rw`.
- Store each discovered device in its own JSON file under `dfrobot-c4004-app/devices/`.
- Migrate legacy single-file `c4004-devices.json` inventories into per-device files on first read.
- Log device storage directory paths on backend startup for easier debugging.

## 0.0.15

- Make the Tracking workspace more compact for 2K displays and Home Assistant iframe sizing.
- Reduce the Tracking topbar height, side panel width, card padding, target table height, and responsive map height.
- Tighten zone status and zone setup rows so the full Tracking interface fits with less scrolling.

## 0.0.14

- Keep the Tracking coordinate canvas inside a dedicated map panel so it is not covered by controls or the target table.
- Add SVG padding and contain-style scaling so the full X/Y axis range remains visible across screen ratios.
- Adjust narrow-screen Tracking layout to stack the map, zone controls, and target table without clipping the coordinate view.

## 0.0.13

- Apply the fullscreen workspace layout to Check, Tracking, and Debug Log.
- Keep the shared workspace, floating navigation, panels, and tracking canvas in a light visual theme.
- Add a scrollable workspace content layer for non-tracking pages so Check and Debug Log fit the same layout model.

## 0.0.12

- Convert the Tracking view into a fullscreen workspace layout.
- Make the coordinate canvas fill the viewport.
- Move Tracking navigation, zone controls, status cards, and target table into floating panels.
- Keep Check and Debug Log on the standard page layout.

## 0.0.11

- Add editable Tracking zone shape settings.
- Support rectangle zones with xMin, xMax, yMin, and yMax parameters.
- Support circle zones with centerX, centerY, and radius parameters.
- Redraw zone shapes live on the coordinate canvas as placeholder settings change.

## 0.0.10

- Update the Tracking coordinate canvas to match the C4004 forward-facing range.
- Show only the X positive half-axis from 0m to 8m.
- Show the Y range from -5m to 5m around the X axis.
- Reposition placeholder zones, targets, and trajectory points into the new visible coordinate range.

## 0.0.9

- Add a Tracking view scaffold for the future C4004 realtime trajectory feature.
- Add a coordinate canvas with X/Y axes, grid lines, six configurable-looking zone areas, and placeholder trajectory points.
- Add six zone status cards showing occupied and empty states.
- Add a target information table with fixed target indexes 1-8 and ID, Kinesia, Feature, X, and Y columns.
- Keep the Tracking layout responsive for Home Assistant sidebar and wider desktop views.

## 0.0.8

- Rework the Communication Check view into module-based panels.
- Keep readback values and related settings together inside each C4004 function module.
- Make readback values more prominent while keeping setting and action controls compact.
- Prevent write controls, inputs, badges, and button states from overflowing into neighboring modules.
- Hide timestamp-style button states from action rows to avoid noisy UI content.

## 0.0.7

- Update the frontend layout to use responsive behavior similar to `everything-presence-mmwave-configurator`.
- Improve Home Assistant sidebar usability with adaptive top controls, status cards, entity groups, and write rows.
- Keep diagnostic-only content in the Debug Log view.
- Simplify the Communication Check view so it focuses on live readback and write testing.

## 0.0.6

- Remember the last selected entity prefix in the browser so returning to the sidebar keeps `auto` or the chosen prefix.
- Default new add-on installs to `auto` prefix matching.
- Optimistically update switch, number, and select states after successful service calls.
- Add delayed refreshes after write actions to wait for Home Assistant and ESPHome state propagation.
- Add a dedicated Debug Log view for backend, Home Assistant, entity, prefix discovery, and runtime diagnostic details.
- Add an in-memory backend diagnostic log buffer exposed through `/api/debug/logs`.
- Show expanded prefix candidate details and recent discovery/state/write events in the UI.
- Group C4004 readback and write controls by function instead of showing one flat list.
- Add entity groups for status, presence, trajectory, installation, detection range, people counting, and system actions.
- Align C4004 UI grouping with the module headings from `User Agreement Guide -V1.3.xls`.
- Use protocol module names such as 系统功能, 工作状态, 雷达安装信息, 人体存在功能, 轨迹跟踪功能, 雷达探测范围限制信息, and 人数统计功能.

## 0.0.5

- Add debug logging for C4004 discovery, state matching, and write service calls.
- Add an `auto` entity prefix mode to combine C4004 entities that Home Assistant created under different prefixes.
- Fix discovery suffix matching so `factory_reset` is not also reported as a separate `reset` prefix candidate.

## 0.0.4

- Add C4004 entity prefix discovery from Home Assistant states.
- Show detected prefix candidates in the communication check UI.
- Improve missing-entity diagnosis when the ESPHome entity IDs do not match the configured prefix.

## 0.0.3

- Add fallback Home Assistant token loading from s6 environment files.
- Add optional `ha_long_lived_token`, `ha_base_url`, and `c4004_entity_prefix` add-on options.
- Show the Home Assistant token source in the UI for easier debugging.

## 0.0.2

- Replace the initial Python static server with a Node.js backend and Vite React frontend.
- Add `/api/health`, `/api/ha/status`, `/api/c4004/state`, and `/api/c4004/write`.
- Add read/write validation for C4004 ESPHome entities through Home Assistant services.
- Move ingress and exposed port to `42069`.

## 0.0.1

- Initial Home Assistant add-on scaffold.
