import { AppConfig } from "./config";

export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistantEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  disabled_by?: string | null;
}

export interface HomeAssistantDeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  sw_version?: string | null;
  hw_version?: string | null;
  area_id?: string | null;
  connections?: Array<[string, string]>;
  identifiers?: Array<[string, string]>;
}

export class HomeAssistantClient {
  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.haToken);
  }

  async getStates(): Promise<HomeAssistantState[]> {
    return this.request<HomeAssistantState[]>("/states");
  }

  async getState(entityId: string): Promise<HomeAssistantState> {
    return this.request<HomeAssistantState>(`/states/${encodeURIComponent(entityId)}`);
  }

  async getEntityRegistry(): Promise<HomeAssistantEntityRegistryEntry[]> {
    try {
      return this.asArray<HomeAssistantEntityRegistryEntry>(await this.request<unknown>("/config/entity_registry"));
    } catch {
      const template = `
{% set entities = namespace(list=[]) %}
{% for state in states %}
  {% set entities.list = entities.list + [{
    'entity_id': state.entity_id,
    'device_id': device_id(state.entity_id),
    'disabled_by': none
  }] %}
{% endfor %}
{{ entities.list | tojson }}`.trim();
      const rendered = await this.renderTemplate(template);
      return this.asArray<HomeAssistantEntityRegistryEntry>(JSON.parse(rendered));
    }
  }

  async getDeviceRegistry(): Promise<HomeAssistantDeviceRegistryEntry[]> {
    try {
      return this.asArray<HomeAssistantDeviceRegistryEntry>(await this.request<unknown>("/config/device_registry"));
    } catch {
      const template = `
{% set devices = namespace(list=[]) %}
{% set seen = namespace(ids=[]) %}
{% for state in states %}
  {% set dev_id = device_id(state.entity_id) %}
  {% if dev_id and dev_id not in seen.ids %}
    {% set seen.ids = seen.ids + [dev_id] %}
    {% set devices.list = devices.list + [{
      'id': dev_id,
      'name': device_attr(dev_id, 'name'),
      'name_by_user': device_attr(dev_id, 'name_by_user'),
      'manufacturer': device_attr(dev_id, 'manufacturer'),
      'model': device_attr(dev_id, 'model'),
      'sw_version': device_attr(dev_id, 'sw_version'),
      'hw_version': device_attr(dev_id, 'hw_version'),
      'area_id': device_attr(dev_id, 'area_id'),
      'connections': device_attr(dev_id, 'connections') | list if device_attr(dev_id, 'connections') else [],
      'identifiers': device_attr(dev_id, 'identifiers') | list if device_attr(dev_id, 'identifiers') else []
    }] %}
  {% endif %}
{% endfor %}
{{ devices.list | tojson }}`.trim();
      const rendered = await this.renderTemplate(template);
      return this.asArray<HomeAssistantDeviceRegistryEntry>(JSON.parse(rendered));
    }
  }

  async callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  private async renderTemplate(template: string): Promise<string> {
    const rendered = await this.request<unknown>("/template", {
      method: "POST",
      body: JSON.stringify({ template }),
    });
    return typeof rendered === "string" ? rendered : JSON.stringify(rendered);
  }

  private asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.haToken) {
      throw new Error("Home Assistant token is not configured");
    }

    const res = await fetch(`${this.config.haBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.haToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Home Assistant API ${res.status} ${res.statusText}: ${text}`);
    }

    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      return text as T;
    }
  }
}
