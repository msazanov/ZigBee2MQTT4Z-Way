function modulePostRender() {
    $('[data-alpaca-container-item-name="enabledMQTTDevicesArray"] .alpaca-control.checkbox [data-checkbox-value$="__"]').each(function(i, e){ e.parentElement.style.fontWeight = "bold"; e.remove() });
}
