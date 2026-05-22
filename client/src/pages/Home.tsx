import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { openWatchlistStream, type WatchlistStreamConnectionState } from "@/lib/watchlistStream";
import { trpc } from "@/lib/trpc";
import {
  Bell,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type SupportedCountry = "TH" | "CN" | "US";

type DraftTargetMap = Record<number, { cutloss: string; sale: string }>;

const DEFAULT_AUTO_REFRESH_SECONDS = 120;
const DASHBOARD_STALE_TIME_MS = 5 * 60_000;

const COUNTRY_LABELS: Record<SupportedCountry, string> = {
  TH: "Thailand",
  CN: "China",
  US: "US",
};

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validateTargetDraft(draft: { cutloss: string; sale: string }) {
  const hasCutloss = draft.cutloss.trim().length > 0;
  const hasSale = draft.sale.trim().length > 0;
  const cutloss = parseOptionalNumber(draft.cutloss);
  const sale = parseOptionalNumber(draft.sale);

  if (hasCutloss && cutloss === null) {
    return {
      cutloss: null,
      sale: null,
      error: "Cutloss ต้องเป็นตัวเลขบวก",
    };
  }

  if (hasSale && sale === null) {
    return {
      cutloss: null,
      sale: null,
      error: "Sale ต้องเป็นตัวเลขบวก",
    };
  }

  if (cutloss !== null && sale !== null && cutloss >= sale) {
    return {
      cutloss,
      sale,
      error: "ค่า Cutloss ต้องน้อยกว่าค่า Sale",
    };
  }

  return {
    cutloss,
    sale,
    error: null,
  };
}

function formatPrice(value: number, currency?: string | null) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}${currency ? ` ${currency}` : ""}`;
}

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatDataAccessMessage(message: string) {
  if (message.includes("โควต้าการใช้งานข้อมูลหมด")) {
    return "บริการข้อมูลราคาหุ้นชั่วคราวไม่พร้อมใช้งาน เพราะโควต้าการใช้งานข้อมูลหมด กรุณาลองใหม่ภายหลัง";
  }
  return message;
}

export default function Home() {
  const utils = trpc.useUtils();
  const lastHandledStreamRefreshAtRef = useRef<number | null>(null);
  const dashboardQuery = trpc.watchlist.dashboard.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
  const refreshMutation = trpc.watchlist.refresh.useMutation({
    onSuccess: async data => {
      utils.watchlist.dashboard.setData(undefined, current =>
        current
          ? {
              ...current,
              total: data.total,
              settings: data.settings,
              items: data.items,
            }
          : current
      );
      if (data.notifications.length > 0 && streamStatus !== "open") {
        toast.success(`ส่งแจ้งเตือนแล้ว ${data.notifications.length} รายการ`);
      }
    },
    onError: error => {
      toast.error(formatDataAccessMessage(error.message));
    },
  });
  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: async () => {
      if (streamStatus !== "open") {
        await utils.watchlist.dashboard.invalidate();
      }
      toast.success("เพิ่มหุ้นเข้า watchlist แล้ว");
      setSubmittedSearch(null);
      setSearchInput("");
    },
    onError: error => {
      toast.error(formatDataAccessMessage(error.message));
    },
  });
  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: async () => {
      if (streamStatus !== "open") {
        await utils.watchlist.dashboard.invalidate();
      }
      toast.success("ลบหุ้นออกจาก watchlist แล้ว");
    },
    onError: error => {
      toast.error(formatDataAccessMessage(error.message));
    },
  });
  const updateTargetsMutation = trpc.watchlist.updateTargets.useMutation({
    onSuccess: async () => {
      if (streamStatus !== "open") {
        await utils.watchlist.dashboard.invalidate();
      }
      toast.success("บันทึก Cutloss และ Sale แล้ว");
    },
    onError: error => {
      toast.error(formatDataAccessMessage(error.message));
    },
  });
  const saveSettingsMutation = trpc.watchlist.saveSettings.useMutation({
    onSuccess: async data => {
      utils.watchlist.dashboard.setData(undefined, current =>
        current
          ? {
              ...current,
              settings: data,
            }
          : current
      );
      toast.success("บันทึกการตั้งค่าแจ้งเตือนแล้ว");
    },
    onError: error => {
      toast.error(formatDataAccessMessage(error.message));
    },
  });

  const [searchCountry, setSearchCountry] = useState<SupportedCountry>("US");
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState<{ country: SupportedCountry; query: string } | null>(null);
  const [draftTargets, setDraftTargets] = useState<DraftTargetMap>({});
  const [validationErrors, setValidationErrors] = useState<Record<number, string>>({});
  const [settingsForm, setSettingsForm] = useState({
    lineUserId: "",
    lineTargetType: "user" as "user" | "group" | "room",
    alertsEnabled: true,
    autoRefreshSeconds: DEFAULT_AUTO_REFRESH_SECONDS,
  });
  const [streamStatus, setStreamStatus] = useState<WatchlistStreamConnectionState>("connecting");
  const [streamWarningMessage, setStreamWarningMessage] = useState<string | null>(null);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);
  const [lastStreamRefreshAtMs, setLastStreamRefreshAtMs] = useState<number | null>(null);

  const searchQuery = trpc.watchlist.search.useQuery(submittedSearch ?? { country: "US", query: "AAPL" }, {
    enabled: Boolean(submittedSearch),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const liveDashboard = dashboardQuery.data ?? refreshMutation.data;
  const items = liveDashboard?.items ?? [];
  const settings = liveDashboard?.settings;
  const lastKnownPriceAtMs = useMemo(
    () => items.reduce<number | null>((latest, item) => Math.max(latest ?? 0, item.lastPriceAtMs ?? 0) || null, null),
    [items]
  );
  const lastCompletedRefreshAtMs = lastStreamRefreshAtMs ?? refreshMutation.data?.refreshedAtMs ?? lastKnownPriceAtMs;

  useEffect(() => {
    if (!settings) return;
    setSettingsForm({
      lineUserId: settings.lineUserId ?? "",
      lineTargetType: settings.lineTargetType,
      alertsEnabled: settings.alertsEnabled,
      autoRefreshSeconds: settings.autoRefreshSeconds,
    });
    }, [settings?.id, settings?.updatedAtMs, settings?.lineUserId, settings?.lineTargetType, settings?.alertsEnabled, settings?.autoRefreshSeconds]);
  useEffect(() => {

    if (!items.length) return;
    setDraftTargets(current => {
      const next: DraftTargetMap = { ...current };
      const validIds = new Set<number>();
      for (const item of items) {
        validIds.add(item.id);
        if (!next[item.id]) {
          next[item.id] = {
            cutloss: item.cutloss?.toString() ?? "",
            sale: item.sale?.toString() ?? "",
          };
        }
      }
      Object.keys(next).forEach(key => {
        if (!validIds.has(Number(key))) {
          delete next[Number(key)];
        }
      });
      return next;
    });
  }, [items]);
  useEffect(() => {
    const closeStream = openWatchlistStream({
      onStatusChange: status => {
        setStreamStatus(status);
        if (status === "open") {
          setStreamErrorMessage(null);
        }
      },
      onStreamError: message => {
        setStreamErrorMessage(formatDataAccessMessage(message));
      },
      onSnapshot: snapshot => {
        const payload = snapshot.payload;
        setStreamStatus("open");
        setStreamErrorMessage(null);
        setStreamWarningMessage(
          payload.warnings.length > 0 ? formatDataAccessMessage(payload.warnings[0]?.message ?? "") : null
        );
        setLastStreamRefreshAtMs(payload.refreshedAtMs ?? null);
        utils.watchlist.dashboard.setData(undefined, current => ({
          limit: payload.limit,
          total: payload.total,
          settings: payload.settings,
          items: payload.items,
        }));

        if (
          snapshot.kind === "refresh" &&
          payload.notifications.length > 0 &&
          lastHandledStreamRefreshAtRef.current !== payload.refreshedAtMs
        ) {
          lastHandledStreamRefreshAtRef.current = payload.refreshedAtMs;
          toast.success(`ส่งแจ้งเตือนแล้ว ${payload.notifications.length} รายการ`);
        }
      },
    });

    return () => {
      closeStream();
    };
  }, [utils.watchlist.dashboard]);


  const countsByCountry = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.country] += 1;
        return acc;
      },
      { TH: 0, CN: 0, US: 0 } as Record<SupportedCountry, number>
    );
  }, [items]);

  const pendingSearch = submittedSearch?.query.trim().length ? submittedSearch : null;

  const handleSearch = () => {
    if (!searchInput.trim()) {
      toast.error("กรุณาระบุสัญลักษณ์หุ้นก่อนค้นหา");
      return;
    }

    setSubmittedSearch({
      country: searchCountry,
      query: searchInput.trim(),
    });
  };

  const handleSaveTargets = (id: number) => {
    const draft = draftTargets[id];
    if (!draft) return;

    const validation = validateTargetDraft(draft);
    if (validation.error) {
      setValidationErrors(current => ({
        ...current,
        [id]: validation.error,
      }));
      toast.error(validation.error);
      return;
    }

    setValidationErrors(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    updateTargetsMutation.mutate({
      id,
      cutloss: validation.cutloss,
      sale: validation.sale,
    });
  };

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({
      lineUserId: settingsForm.lineUserId.trim() || null,
      lineTargetType: settingsForm.lineTargetType,
      alertsEnabled: settingsForm.alertsEnabled,
      autoRefreshSeconds: settingsForm.autoRefreshSeconds,
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl">Stock Watchlist</CardTitle>
                  <CardDescription>
                    ติดตามราคาหุ้นไทย จีน และสหรัฐ พร้อม Cutloss, Sale และการแจ้งเตือนผ่าน Line
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => refreshMutation.mutate({ sendAlerts: true })}
                  disabled={refreshMutation.isPending || dashboardQuery.isLoading}
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  รีเฟรชราคา
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-muted/60 p-4">
                  <p className="text-sm text-muted-foreground">จำนวนหุ้นใน Watchlist</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{items.length}/50</p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-4">
                  <p className="text-sm text-muted-foreground">Auto-refresh</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{settings?.autoRefreshSeconds ?? 60}s</p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-4">
                  <p className="text-sm text-muted-foreground">แจ้งเตือนล่าสุด</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{formatDateTime(items.find(item => item.lastAlertAtMs)?.lastAlertAtMs)}</p>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader>
              <CardTitle className="text-base">ภาพรวมตลาดใน Watchlist</CardTitle>
              <CardDescription>สัดส่วนรายการหุ้นตามประเทศ</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {(["TH", "CN", "US"] as SupportedCountry[]).map(country => (
                <div key={country} className="rounded-2xl border border-border/70 bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{COUNTRY_LABELS[country]}</span>
                    <Badge variant="secondary">{country}</Badge>
                  </div>
                  <p className="mt-3 text-2xl font-semibold">{countsByCountry[country]}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {dashboardQuery.error && !liveDashboard ? (
          <Card className="border-0 shadow-sm ring-1 ring-destructive/20">
            <CardContent className="flex items-start gap-3 p-6 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-medium">ไม่สามารถโหลดข้อมูล watchlist ได้</p>
                <p className="mt-1 text-destructive/80">{dashboardQuery.error?.message}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {streamWarningMessage ? (
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            การอัปเดตราคาล่าสุดมีบางรายการอัปเดตไม่ได้: {streamWarningMessage}
          </div>
        ) : null}

        {(streamErrorMessage || refreshMutation.error) && liveDashboard ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            การอัปเดตข้อมูลล่าสุดมีปัญหา: {streamErrorMessage ?? formatDataAccessMessage(refreshMutation.error?.message ?? "")}
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Card className="border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader>
              <CardTitle className="text-base">ค้นหาและเพิ่มหุ้น</CardTitle>
              <CardDescription>
                ค้นหาด้วยสัญลักษณ์หุ้น เช่น PTT, 600519, AAPL แล้วเลือกประเทศให้ถูกต้องก่อนเพิ่มเข้า watchlist
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                <Select value={searchCountry} onValueChange={value => setSearchCountry(value as SupportedCountry)}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกประเทศ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TH">Thailand / SET</SelectItem>
                    <SelectItem value="CN">China / Investing.com</SelectItem>
                    <SelectItem value="US">US / NASDAQ</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={searchInput}
                  onChange={event => setSearchInput(event.target.value)}
                  placeholder="เช่น PTT, 600519.SS, AAPL"
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      handleSearch();
                    }
                  }}
                />
                <Button className="gap-2" onClick={handleSearch} disabled={searchQuery.isFetching}>
                  {searchQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  ค้นหา
                </Button>
              </div>

              {pendingSearch && (
                <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4">
                  {searchQuery.isFetching ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      กำลังค้นหาราคาหุ้นล่าสุด...
                    </div>
                  ) : searchQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <CircleAlert className="mt-0.5 h-4 w-4" />
                      <span>{formatDataAccessMessage(searchQuery.error.message)}</span>
                    </div>
                  ) : searchQuery.data ? (
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold">{searchQuery.data.displayName}</p>
                          <Badge variant="secondary">{searchQuery.data.symbol}</Badge>
                          <Badge variant="outline">{COUNTRY_LABELS[searchQuery.data.country]}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {searchQuery.data.exchangeName || "-"} · อ้างอิง {searchQuery.data.sourceName}
                        </p>
                        <p className="mt-3 text-xl font-semibold">{formatPrice(searchQuery.data.currentPrice, searchQuery.data.currency)}</p>
                      </div>
                      <Button
                        className="gap-2"
                        onClick={() => addMutation.mutate({ country: searchCountry, query: searchInput.trim() })}
                        disabled={addMutation.isPending || items.length >= 50}
                      >
                        {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        เพิ่มเข้า Watchlist
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader>
              <CardTitle className="text-base">ตั้งค่า Line Alert</CardTitle>
              <CardDescription>
                ตั้งค่า recipient ID, ประเภทปลายทาง และช่วงเวลา auto-refresh สำหรับการตรวจจับ Cutloss / Sale
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Line recipient ID</label>
                <Input
                  value={settingsForm.lineUserId}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      lineUserId: event.target.value,
                    }))
                  }
                  placeholder="ใส่ LINE userId / groupId / roomId"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">ประเภทปลายทาง</label>
                <Select
                  value={settingsForm.lineTargetType}
                  onValueChange={value =>
                    setSettingsForm(current => ({
                      ...current,
                      lineTargetType: value as "user" | "group" | "room",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกประเภทปลายทาง" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                    <SelectItem value="room">Room</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Auto-refresh (วินาที)</label>
                <Input
                  type="number"
                  min={15}
                  max={3600}
                  value={settingsForm.autoRefreshSeconds}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      autoRefreshSeconds: Number(event.target.value || 60),
                    }))
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-border/70 p-4">
                <div>
                  <p className="font-medium">เปิดใช้งานการแจ้งเตือน</p>
                  <p className="text-sm text-muted-foreground">ระบบจะตรวจจับเมื่อราคา ≤ Cutloss และราคา ≥ Sale</p>
                </div>
                <Switch
                  checked={settingsForm.alertsEnabled}
                  onCheckedChange={checked =>
                    setSettingsForm(current => ({
                      ...current,
                      alertsEnabled: checked,
                    }))
                  }
                />
              </div>

              <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
                {settings?.lineTokenConfigured ? (
                  <span>LINE channel access token ถูกตั้งค่าแล้ว ระบบพร้อมส่งข้อความเมื่อเข้าเงื่อนไข</span>
                ) : (
                  <span>
                    ยังไม่ได้ตั้งค่า LINE channel access token ในระบบ จึงยังส่งข้อความจริงไม่ได้ แม้ UI และ logic พร้อมใช้งานแล้ว
                  </span>
                )}
              </div>

              <Button className="w-full gap-2" onClick={handleSaveSettings} disabled={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                บันทึกการตั้งค่าแจ้งเตือน
              </Button>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">Watchlist</CardTitle>
                  <CardDescription>
                    ตารางติดตามราคาหุ้นพร้อมคอลัมน์ลำดับ ประเทศ ชื่อหุ้น ราคาปัจจุบัน Cutloss และ Sale
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={streamStatus === "open" ? "secondary" : "outline"}>
                    {streamStatus === "open"
                      ? "Live stream"
                      : streamStatus === "connecting"
                        ? "Connecting stream"
                        : "Reconnecting stream"}
                  </Badge>
                  <Badge variant="outline">Last refresh: {formatDateTime(lastCompletedRefreshAtMs)}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading && !liveDashboard ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังโหลด watchlist...
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
                  <p className="text-lg font-medium">ยังไม่มีหุ้นใน Watchlist</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    เริ่มจากค้นหาหุ้นที่ต้องการ แล้วเพิ่มเข้า watchlist ได้สูงสุด 50 รายการ
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ลำดับ</TableHead>
                        <TableHead>ประเทศ</TableHead>
                        <TableHead>ชื่อหุ้น</TableHead>
                        <TableHead className="min-w-[160px]">ราคาปัจจุบัน</TableHead>
                        <TableHead className="min-w-[180px]">Cutloss</TableHead>
                        <TableHead className="min-w-[180px]">Sale</TableHead>
                        <TableHead className="min-w-[180px] text-right">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.order}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{COUNTRY_LABELS[item.country as SupportedCountry]}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium leading-none">{item.displayName}</p>
                              <p className="text-sm text-muted-foreground">{item.symbol} · {item.sourceName}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{formatPrice(item.currentPrice, item.currency)}</p>
                              <p className="text-xs text-muted-foreground">อัปเดต {formatDateTime(item.lastPriceAtMs)}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.0001"
                              value={draftTargets[item.id]?.cutloss ?? ""}
                              onChange={event => {
                                setDraftTargets(current => ({
                                  ...current,
                                  [item.id]: {
                                    cutloss: event.target.value,
                                    sale: current[item.id]?.sale ?? item.sale?.toString() ?? "",
                                  },
                                }));
                                setValidationErrors(current => {
                                  const next = { ...current };
                                  delete next[item.id];
                                  return next;
                                });
                              }}
                              placeholder="เช่น 32.50"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.0001"
                              value={draftTargets[item.id]?.sale ?? ""}
                              onChange={event => {
                                setDraftTargets(current => ({
                                  ...current,
                                  [item.id]: {
                                    cutloss: current[item.id]?.cutloss ?? item.cutloss?.toString() ?? "",
                                    sale: event.target.value,
                                  },
                                }));
                                setValidationErrors(current => {
                                  const next = { ...current };
                                  delete next[item.id];
                                  return next;
                                });
                              }}
                              placeholder="เช่น 39.00"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => handleSaveTargets(item.id)}
                                  disabled={updateTargetsMutation.isPending}
                                >
                                  บันทึก
                                </Button>
                                <Button
                                  variant="outline"
                                  className="text-destructive"
                                  onClick={() => removeMutation.mutate({ id: item.id })}
                                  disabled={removeMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {validationErrors[item.id] ? (
                                <p className="text-right text-xs text-destructive">{validationErrors[item.id]}</p>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
