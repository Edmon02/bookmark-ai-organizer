// SPDX-License-Identifier: Apache-2.0
// Placeholder analytics module – future events (models_fetch_success, model_fallback_applied, etc.)
export interface AnalyticsEvent {
	name: string;
	properties?: Record<string, string | number | boolean | undefined>;
}

export class Analytics {
	static track(_event: AnalyticsEvent): void {
		// No-op placeholder. Implement batching + privacy filtering later.
	}
}
