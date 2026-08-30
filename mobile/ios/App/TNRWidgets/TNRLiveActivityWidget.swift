import ActivityKit
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island presentation for the hospital, training and war
/// countdowns.
///
/// One widget covers all three because `TNRActivityAttributes` carries the kind: the
/// layout is the same countdown either way, only the icon and wording differ, and three
/// near-identical widgets would be three places to fix a spacing bug.
struct TNRLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TNRActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(TNRStyle.tile.opacity(0.9))
                .activitySystemActionForegroundColor(TNRStyle.ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.kind.symbol)
                        .font(.system(size: 20))
                        .foregroundStyle(TNRStyle.ink)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.endsAt, style: .timer)
                        .font(.system(size: 20, weight: .semibold))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 90)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let subtitle = context.state.subtitle {
                        Text(subtitle)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.kind.symbol)
            } compactTrailing: {
                Text(context.state.endsAt, style: .timer)
                    .monospacedDigit()
                    // Without a width cap the timer pushes the compact island wider on
                    // every tick as the digits change.
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: context.attributes.kind.symbol)
            }
            .keylineTint(TNRStyle.tile)
        }
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<TNRActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: context.attributes.kind.symbol)
                .font(.system(size: 26))
                .foregroundStyle(TNRStyle.ink)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(context.state.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(TNRStyle.ink)
                    .lineLimit(1)
                if let subtitle = context.state.subtitle {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(TNRStyle.ink.opacity(0.7))
                        .lineLimit(1)
                }
                if let progress = context.state.progress {
                    ProgressView(value: progress)
                        .tint(TNRStyle.ink)
                        .frame(height: 4)
                        .padding(.top, 2)
                }
            }

            Spacer(minLength: 4)

            // The system keeps a `.timer` text ticking on its own, so the countdown stays
            // right between the pushes that change the underlying state.
            Text(context.state.endsAt, style: .timer)
                .font(.system(size: 22, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(TNRStyle.ink)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 96)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(context.attributes.kind.accessibilityLabel)
    }
}
