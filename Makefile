include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-unifi-network
LUCI_NAME:=$(PKG_NAME)
PKG_VERSION:=1.0.0
PKG_RELEASE:=9
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_PO_VERSION:=$(PKG_VERSION)-r$(PKG_RELEASE)

LUCI_TITLE:=UniFi Network AP and client dashboard
LUCI_DEPENDS:=+luci-base +luci-mod-status +curl +jq +qrencode
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/unifi
endef

define Package/$(PKG_NAME)/postinst
[ -n "$${IPKG_INSTROOT}" ] || { \
	chmod 0600 /etc/config/unifi; \
	rm -f /tmp/luci-indexcache.*; \
	rm -rf /tmp/luci-modulecache/; \
	/etc/init.d/rpcd reload 2>/dev/null; \
	exit 0; \
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
