"use client";

import { Component, type ReactNode } from "react";
import { reportBrowserIncident } from "@/lib/diagnostics-client";
import type { ViewerCamera } from "@/lib/viewer-protocol";
import "./recovery.css";

export class CameraBoundary extends Component<{
  camera: ViewerCamera; visible: boolean; slot: string; children: ReactNode;
}, {failed: boolean; reference: string}> {
  state = {failed: false, reference: ""};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error: Error) {
    this.setState({reference: reportBrowserIncident({code: "render_failed", operation: "render", camera: this.props.camera.id, error})});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className={`vision-tile vision-camera-fallback ${this.props.slot}`} hidden={!this.props.visible}
      data-camera-id={this.props.camera.id} aria-label={`${this.props.camera.label} unavailable`}>
      <strong>{this.props.camera.label}</strong><p>This camera view could not be displayed.</p>
      <button onClick={() => this.setState({failed: false, reference: ""})}>Try this view again</button>
      <small>Then press Play to resume live viewing.</small>
      {this.state.reference ? <small>Reference: {this.state.reference}</small> : null}
    </section>;
  }
}
