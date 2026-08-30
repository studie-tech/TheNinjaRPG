#!/usr/bin/env ruby
# frozen_string_literal: true

# Configures the generated Xcode project: capabilities, the widget extension target and
# the build settings both need.
#
# `cap add ios` produces a bare template, and everything below is the difference between
# that template and an app that can receive pushes, run Live Activities, share a container
# with its widgets and sign in with Apple. It is written as a script rather than applied by
# hand so the changes are reviewable, repeatable, and survive regenerating the project.
#
# Idempotent: running it twice is a no-op. Requires the `xcodeproj` gem.
#
#   gem install xcodeproj
#   ruby scripts/configure-xcode.rb

require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
PROJECT_PATH = File.join(ROOT, "ios/App/App.xcodeproj")
APP_TARGET = "App"
WIDGET_TARGET = "TNRWidgets"
BUNDLE_ID = ENV.fetch("TNR_APP_ID", "com.theninjarpg.app")
APP_GROUP = "group.#{BUNDLE_ID}"
# ActivityKit needs 16.1. The app itself stays lower so iOS 15 devices can still play;
# the Live Activity code is behind an availability check.
APP_DEPLOYMENT_TARGET = "15.0"
WIDGET_DEPLOYMENT_TARGET = "16.1"

abort "No Xcode project at #{PROJECT_PATH}. Run `bun run add:ios` first." unless Dir.exist?(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == APP_TARGET } or abort "No #{APP_TARGET} target"

def set_setting(target, key, value)
  target.build_configurations.each { |config| config.build_settings[key] = value }
end

# --- App target ------------------------------------------------------------------------

set_setting(app, "CODE_SIGN_ENTITLEMENTS", "App/App.entitlements")
set_setting(app, "PRODUCT_BUNDLE_IDENTIFIER", BUNDLE_ID)
set_setting(app, "IPHONEOS_DEPLOYMENT_TARGET", APP_DEPLOYMENT_TARGET)
# The widget extension is Swift 5.9+ syntax; keep both targets on the same toolchain.
set_setting(app, "SWIFT_VERSION", "5.0")

# --- Widget extension target -----------------------------------------------------------

widget = project.targets.find { |t| t.name == WIDGET_TARGET }
if widget.nil?
  widget = project.new_target(
    :app_extension,
    WIDGET_TARGET,
    :ios,
    WIDGET_DEPLOYMENT_TARGET,
    project.products_group,
    :swift,
  )
  puts "Created #{WIDGET_TARGET} target"
end

set_setting(widget, "PRODUCT_BUNDLE_IDENTIFIER", "#{BUNDLE_ID}.widgets")
set_setting(widget, "INFOPLIST_FILE", "#{WIDGET_TARGET}/Info.plist")
set_setting(widget, "CODE_SIGN_ENTITLEMENTS", "#{WIDGET_TARGET}/#{WIDGET_TARGET}.entitlements")
set_setting(widget, "IPHONEOS_DEPLOYMENT_TARGET", WIDGET_DEPLOYMENT_TARGET)
set_setting(widget, "SWIFT_VERSION", "5.0")
set_setting(widget, "SKIP_INSTALL", "YES")
set_setting(widget, "CODE_SIGN_STYLE", "Automatic")
set_setting(widget, "TARGETED_DEVICE_FAMILY", "1,2")
set_setting(widget, "GENERATE_INFOPLIST_FILE", "NO")
set_setting(widget, "MARKETING_VERSION", "1.0")
set_setting(widget, "CURRENT_PROJECT_VERSION", "1")

# --- Source files ----------------------------------------------------------------------

# The shared models compile into both targets: the app writes the snapshot and starts the
# activities, the extension renders them, and a second copy of the types would drift.
def sync_sources(project, target, group_name, relative_dir, extra_targets = [])
  group = project.main_group.find_subpath(group_name, true)
  group.set_source_tree("SOURCE_ROOT")
  group.set_path(relative_dir)

  absolute = File.join(File.dirname(project.path), relative_dir)
  return unless Dir.exist?(absolute)

  Dir.glob(File.join(absolute, "**", "*.swift")).sort.each do |path|
    name = Pathname.new(path).relative_path_from(Pathname.new(absolute)).to_s
    file = group.files.find { |f| f.path == name } || group.new_file(name)
    ([target] + extra_targets).each do |t|
      next if t.source_build_phase.files_references.include?(file)
      t.source_build_phase.add_file_reference(file)
    end
  end
end

sync_sources(project, app, "TNRShared", "TNRShared", [widget])
sync_sources(project, app, "Plugins", "App/Plugins")
sync_sources(project, widget, WIDGET_TARGET, WIDGET_TARGET)

# Widget assets
widget_assets = File.join(File.dirname(PROJECT_PATH), WIDGET_TARGET, "Assets.xcassets")
if Dir.exist?(widget_assets)
  group = project.main_group.find_subpath(WIDGET_TARGET, true)
  ref = group.files.find { |f| f.path == "Assets.xcassets" } || group.new_file("Assets.xcassets")
  unless widget.resources_build_phase.files_references.include?(ref)
    widget.resources_build_phase.add_file_reference(ref)
  end
end

# --- Embed the extension in the app ------------------------------------------------------

embed_phase = app.copy_files_build_phases.find { |phase| phase.name == "Embed App Extensions" }
if embed_phase.nil?
  embed_phase = app.new_copy_files_build_phase("Embed App Extensions")
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
end
unless embed_phase.files_references.include?(widget.product_reference)
  build_file = embed_phase.add_file_reference(widget.product_reference)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
end
app.add_dependency(widget) unless app.dependencies.any? { |d| d.target == widget }

# --- Capabilities ------------------------------------------------------------------------

# Xcode reads these from the target attributes; without them it shows the capability as
# off even though the entitlements file grants it.
attributes = project.root_object.attributes["TargetAttributes"] ||= {}
(attributes[app.uuid] ||= {})["SystemCapabilities"] = {
  "com.apple.ApplicationGroups.iOS" => { "enabled" => 1 },
  "com.apple.Push" => { "enabled" => 1 },
  "com.apple.SafariKeychain" => { "enabled" => 1 },
  "com.apple.developer.applesignin" => { "enabled" => 1 },
  "com.apple.BackgroundModes" => { "enabled" => 1 },
}
(attributes[widget.uuid] ||= {})["SystemCapabilities"] = {
  "com.apple.ApplicationGroups.iOS" => { "enabled" => 1 },
}

project.save

# Reopening proves the file we just wrote still parses, which is the only validation
# available without Xcode itself.
Xcodeproj::Project.open(PROJECT_PATH)
puts "Configured #{PROJECT_PATH}"
puts "  app group: #{APP_GROUP}"
puts "  targets:   #{project.targets.map(&:name).join(', ')}"
