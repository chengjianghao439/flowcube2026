import { useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveWorkspaceTab } from './useActiveWorkspaceTab';
import { captureRefundOwner, refundOwnerCurrent, refundConfig, refundRevision, subscribeRefund, refundActivityEpoch, mayReadRefund } from '@/lib/supplierRefundRecovery';
export function useSupplierRefundRead() {
    useSyncExternalStore(subscribeRefund, refundRevision);
    const [owner] = useState(captureRefundOwner), active = useActiveWorkspaceTab(), latest = useRef({ active, generation: 0 });
    if (latest.current.active !== active)
        latest.current.generation++;
    latest.current.active = active;
    const generation = latest.current.generation, activity = refundActivityEpoch();
    const current = () => latest.current.active && latest.current.generation === generation && refundActivityEpoch() === activity && refundOwnerCurrent(owner) && mayReadRefund();
    return { owner, active, generation, activity, current, config: refundConfig(owner), key: [owner.userId, owner.baseURL, owner.sessionGeneration, owner.epoch, generation, activity], error: !mayReadRefund() ? '需要供应商退款与完整原单查看权限' : !refundOwnerCurrent(owner) ? '账号、权限或服务器已变化，原草稿保留' : '' };
}
export function useRefundReadQuery<T>(key: string, identity: unknown, scope: ReturnType<typeof useSupplierRefundRead>, load: () => Promise<T>, enabled = true) {
    const readable = enabled && scope.current();
    const query = useQuery({ queryKey: [key, ...scope.key, identity], queryFn: async () => { if (!scope.current())
            throw Error('原读取已暂停'); const data = await load(); if (!scope.current())
            throw Error('原读取上下文已变化，草稿保留'); return data; }, enabled: readable, staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false });
    return { ...query, data: readable && !query.isFetching && !query.isPaused && !query.isError ? query.data : undefined, ready: readable && !query.isFetching && !query.isPaused && !query.isError && query.data !== undefined, retry: () => { if (readable)
            void query.refetch(); } };
}
