/** Resource counters and their shared tooltip. No simulation state lives here. */
(function (root) {
  'use strict';

  const RESOURCE_TYPES = [
    { key: 'food', label: 'Food', unit: 'days', decimals: 1 },
    { key: 'timber', label: 'Timber', unit: 'm³', decimals: 1 },
    { key: 'turf', label: 'Turf', unit: 'm³', decimals: 1 },
    { key: 'iron', label: 'Iron', unit: 'kg', decimals: 1 },
    { key: 'firewood', label: 'Fuel', unit: 'kg', decimals: 0 },
    { key: 'hay', label: 'Hay', unit: 'kg', decimals: 0 },
    { key: 'water', label: 'Water', unit: 'L', decimals: 0 },
  ];

  const compactNumber = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  class ResourceBar {
    constructor(container, tooltip) {
      this.container = container;
      this.tooltip = tooltip;
      this.activeResource = null;
      this.values = new Map();
      this.items = new Map();
      for (const resource of RESOURCE_TYPES) {
        const item = document.createElement('div');
        item.className = 'resource';
        item.dataset.resource = resource.key;
        item.tabIndex = 0;
        item.innerHTML = /* HTML */ `
          <img src="assets/resources/${resource.key}.svg" alt="" aria-hidden="true" />
          <strong>
            <span class="resource-amount"></span>
            <span class="resource-amount-compact" aria-hidden="true"></span>
          </strong>
        `;
        this.container.appendChild(item);
        this.items.set(resource.key, item);
      }
      this.bindTooltip();
    }

    render(simulation) {
      this.campValues = new Map();
      for (const resource of RESOURCE_TYPES) {
        const value =
          resource.key === 'food' ? simulation.foodDays : simulation.state.resources[resource.key];
        const amount = root.VinlandInterface.number(value, resource.decimals);
        const item = this.items.get(resource.key);
        item.querySelector('.resource-amount').textContent = amount;
        item.querySelector('.resource-amount-compact').textContent =
          value >= 1000 ? compactNumber.format(value) : amount;
        item.setAttribute('aria-label', `${resource.label}: ${amount} ${resource.unit}`);
        item.classList.toggle('warn', resource.key === 'food' && value < 7);
        this.values.set(resource.key, amount);
        this.campValues.set(
          resource.key,
          root.VinlandInterface.number(
            resource.key === 'food'
              ? simulation.campFoodDays
              : simulation.state.storage.stores.camp.stock[resource.key] || 0,
            resource.decimals,
          ),
        );
      }
      // Update a visible tooltip without replacing its focused/hovered counter.
      if (this.activeResource) {
        this.updateTooltipText();
      }
    }

    updateTooltipText() {
      const resource = RESOURCE_TYPES.find(
        (entry) => entry.key === this.activeResource.dataset.resource,
      );
      this.tooltip.querySelector('strong').textContent = resource.label;
      this.tooltip.querySelector('span').textContent =
        `${this.values.get(resource.key)} ${resource.unit} total · ${this.campValues.get(resource.key)} at camp`;
    }

    show(item, x, y) {
      this.activeResource = item;
      item.setAttribute('aria-describedby', this.tooltip.id);
      this.updateTooltipText();
      this.tooltip.hidden = false;
      this.position(x, y);
    }

    position(x, y) {
      const gap = 16;
      const margin = 8;
      const bounds = this.tooltip.getBoundingClientRect();
      // Prefer the right of the pointer; clamp only at the viewport boundary.
      this.tooltip.style.left =
        Math.max(margin, Math.min(x + gap, innerWidth - bounds.width - margin)) + 'px';
      this.tooltip.style.top =
        Math.max(margin, Math.min(y + 12, innerHeight - bounds.height - margin)) + 'px';
    }

    hide() {
      this.activeResource?.removeAttribute('aria-describedby');
      this.activeResource = null;
      this.tooltip.hidden = true;
    }

    bindTooltip() {
      this.container.addEventListener('pointerover', (event) => {
        const item = event.target.closest('.resource');
        if (item && !item.contains(event.relatedTarget)) {
          this.hide();
          this.show(item, event.clientX, event.clientY);
        }
      });
      this.container.addEventListener('pointermove', (event) => {
        if (this.activeResource) {
          this.position(event.clientX, event.clientY);
        }
      });
      this.container.addEventListener('pointerleave', () => this.hide());
      this.container.addEventListener('focusin', (event) => {
        const item = event.target.closest('.resource');
        if (item) {
          const bounds = item.getBoundingClientRect();
          this.hide();
          this.show(item, bounds.right, bounds.top);
        }
      });
      this.container.addEventListener('focusout', () => this.hide());
      this.container.addEventListener('scroll', () => this.hide());
      document.addEventListener('pointerdown', (event) => {
        if (!this.container.contains(event.target)) {
          this.hide();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          this.hide();
        }
      });
      window.addEventListener('resize', () => this.hide());
      window.addEventListener('blur', () => this.hide());
    }
  }

  root.VinlandHud = { ResourceBar };
})(window);
