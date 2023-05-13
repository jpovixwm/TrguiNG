/**
 * transgui-ng - next gen remote GUI for transmission torrent daemon
 * Copyright (C) 2022  qu1ck (mail at qu1ck.org)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { memo, useCallback, useEffect, useMemo } from "react";
import { getTorrentError, type Torrent, type TrackerStats } from "../rpc/torrent";
import { bytesToHumanReadableStr, ensurePathDelimiter, secondsToHumanReadableStr, timestampToDateString } from "../util";
import { FileTreeTable, useUnwantedFiles } from "./tables/filetreetable";
import { PiecesCanvas } from "./piecescanvas";
import { ProgressBar } from "./progressbar";
import { DateField, EtaField, LabelsField, StatusField, TrackerField } from "./tables/torrenttable";
import { TrackersTable } from "./tables/trackertable";
import { PeersTable } from "./tables/peerstable";
import { type SessionStatEntry } from "rpc/transmission";
import { Box, Container, Group, type MantineTheme, Table, Tabs, TextInput } from "@mantine/core";
import * as Icon from "react-bootstrap-icons";
import { CachedFileTree, type FileDirEntry } from "cachedfiletree";
import { useFileTree, useMutateTorrent, useSessionStats, useTorrentDetails } from "queries";

interface DetailsProps {
    torrentId?: number,
    updates: boolean,
}

function DownloadBar(props: { torrent: Torrent }) {
    // temporarily just a progress bar
    const percent = props.torrent.status === 2 ? props.torrent.recheckProgress : props.torrent.percentDone;
    const now = Math.round(percent * 1000);
    const prefix = props.torrent.status === 2 ? "Verified" : "Downloaded";
    const nowStr = `${prefix}: ${now / 10}%`;
    return (
        <Box w="100%" my="0.5rem">
            <ProgressBar now={now} max={1000} label={nowStr} />
        </Box>
    );
}

function Wasted(props: { torrent: Torrent }) {
    const hashfails = props.torrent.pieceSize > 0 ? props.torrent.corruptEver / props.torrent.pieceSize : 0;
    return <>{`${bytesToHumanReadableStr(props.torrent.corruptEver)} (${hashfails} hashfails)`}</>;
}

function DownloadSpeed(props: { torrent: Torrent }) {
    const secondsDownloading = props.torrent.secondsDownloading;
    const speed = `${bytesToHumanReadableStr(props.torrent.rateDownload)}/s`;
    if (secondsDownloading > 0) {
        return <>{`${speed} (average: ${bytesToHumanReadableStr(props.torrent.downloadedEver / secondsDownloading)}/s)`}</>;
    } else {
        return <>{speed}</>;
    }
}

function SpeedLimit(props: { torrent: Torrent, field: "download" | "upload" }) {
    const limited = props.field === "download" ? props.torrent.downloadLimited : props.torrent.uploadLimited;
    if (limited !== true) return <>-</>;
    const limit = props.field === "download" ? props.torrent.downloadLimit : props.torrent.uploadLimit;
    if (limit < 0) return <>∞</>;
    return <>{`${bytesToHumanReadableStr(limit * 1024)}/s`}</>;
}

function Seeds(props: { torrent: Torrent }) {
    const sending = props.torrent.peersSendingToUs as number;
    let totalSeeds = props.torrent.trackerStats.length > 0 ? 0 : -1;
    props.torrent.trackerStats.forEach((tracker: any) => { totalSeeds += tracker.seederCount as number; });
    if (totalSeeds < 0) {
        return <>{sending}</>;
    } else {
        return <>{`${sending} of ${totalSeeds} connected`}</>;
    }
}

function Peers(props: { torrent: Torrent }) {
    const getting = props.torrent.peersGettingFromUs as number;
    let totalLeechers = props.torrent.trackerStats.length > 0 ? 0 : -1;
    props.torrent.trackerStats.forEach((tracker: any) => { totalLeechers += tracker.leecherCount as number; });
    if (totalLeechers < 0) {
        return <>{getting}</>;
    } else {
        return <>{`${getting} of ${totalLeechers} connected`}</>;
    }
}

function TrackerUpdate(props: { torrent: Torrent }) {
    if (props.torrent.trackerStats.length === 0) return <></>;
    const tracker = props.torrent.trackerStats[0] as TrackerStats;
    const state = tracker.announceState;
    return <>{timestampToDateString((state === 2 || state === 3) ? 1 : tracker.nextAnnounceTime)}</>;
}

function TransferTable(props: { torrent: Torrent }) {
    const shareRatio = `${props.torrent.uploadRatio as number} (${secondsToHumanReadableStr(props.torrent.secondsSeeding)})`;
    return (
        <Table p={0}>
            <tbody>
                <tr>
                    <td>Status:</td><td><StatusField {...props} fieldName="status" /></td>
                    <td>Error:</td><td>{getTorrentError(props.torrent)}</td>
                    <td>Remaining:</td><td><EtaField {...props} fieldName="eta" />{` (${bytesToHumanReadableStr(props.torrent.leftUntilDone)})`}</td>
                </tr>
                <tr>
                    <td>Downloaded:</td><td>{bytesToHumanReadableStr(props.torrent.downloadedEver)}</td>
                    <td>Uploaded:</td><td>{bytesToHumanReadableStr(props.torrent.uploadedEver)}</td>
                    <td>Wasted:</td><td><Wasted {...props} /></td>
                </tr>
                <tr>
                    <td>Download speed:</td><td><DownloadSpeed {...props} /></td>
                    <td>Upload speed:</td><td>{`${bytesToHumanReadableStr(props.torrent.rateUpload)}/s`}</td>
                    <td>Share ratio:</td><td>{shareRatio}</td>
                </tr>
                <tr>
                    <td>Download limit:</td><td><SpeedLimit {...props} field="download" /></td>
                    <td>Upload limit:</td><td><SpeedLimit {...props} field="upload" /></td>
                    <td>Bandwidth group:</td><td>{props.torrent.group}</td>
                </tr>
                <tr>
                    <td>Seeds:</td><td><Seeds {...props} /></td>
                    <td>Peers:</td><td><Peers {...props} /></td>
                    <td>Max peers:</td><td>{props.torrent.maxConnectedPeers}</td>
                </tr>
                <tr>
                    <td>Tracker:</td><td><TrackerField {...props} fieldName="trackerStats" /></td>
                    <td>Tracker update on:</td><td><TrackerUpdate {...props} /></td>
                    <td>Last active:</td><td><DateField {...props} fieldName="activityDate" /></td>
                </tr>
            </tbody>
        </Table>
    );
}

function TotalSize(props: { torrent: Torrent }) {
    if (props.torrent.totalSize <= 0) return <>?</>;
    const size = bytesToHumanReadableStr(props.torrent.totalSize);
    const done = bytesToHumanReadableStr(props.torrent.sizeWhenDone - props.torrent.leftUntilDone);
    return <>{`${size} (${done} done)`}</>;
}

function Pieces(props: { torrent: Torrent }) {
    if (props.torrent.totalSize <= 0) return <>?</>;
    const pieceSize = bytesToHumanReadableStr(props.torrent.pieceSize);
    let have = 0;
    if (props.torrent.totalSize === props.torrent.haveValid) {
        have = props.torrent.pieceCount;
    } else {
        have = props.torrent.haveValid / (props.torrent.pieceSize > 0 ? props.torrent.pieceSize : 1);
    }

    return <>{`${props.torrent.pieceCount as number} x ${pieceSize} (have ${Math.round(have)})`}</>;
}

const httpRe = /https?:\/\//;
const urlRe = /(https?:\/\/[^\s]+)/;

function Urlize(props: { text: string }) {
    if (!httpRe.test(props.text)) return <>text</>;
    const matches = props.text.split(urlRe).filter((match) => match.length > 0);
    return <>{matches.map((match, index) => {
        if (!httpRe.test(match)) return <span key={index}>{match}</span>;
        return <a key={index} href={match} target="_blank" rel="noreferrer">{match}</a>;
    })}</>;
}

const readonlyInputStyles = (theme: MantineTheme) => ({
    root: {
        backgroundColor: (theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]),
    },
    input: {
        minHeight: "1rem",
        height: "1rem"
    }
});

function TorrentDetails(props: { torrent: Torrent }) {
    const fullPath = ensurePathDelimiter(props.torrent.downloadDir) + (props.torrent.name as string);
    return (
        <Table>
            <tbody>
                <tr>
                    <td>Full path:</td>
                    <td>{fullPath}</td>
                    <td>Created on:</td>
                    <td><DateField {...props} fieldName="dateCreated" />
                        <span>{` by ${props.torrent.creator as string}`}</span>
                    </td>
                </tr>
                <tr>
                    <td>Total size:</td><td><TotalSize {...props} /></td>
                    <td>Pieces:</td><td><Pieces {...props} /></td>
                </tr>
                <tr>
                    <td>Hash:</td>
                    <td>
                        <TextInput styles={readonlyInputStyles} variant="unstyled" readOnly defaultValue={props.torrent.hashString} />
                    </td>
                    <td>Comment:</td><td><Urlize text={props.torrent.comment} /></td>
                </tr>
                <tr>
                    <td>Added on:</td><td><DateField {...props} fieldName="addedDate" /></td>
                    <td>Completed on:</td><td><DateField {...props} fieldName="doneDate" /></td>
                </tr>
                <tr>
                    <td>Magnet link:</td>
                    <td>
                        <TextInput styles={readonlyInputStyles} variant="unstyled" readOnly defaultValue={props.torrent.magnetLink} />
                    </td>
                    <td>Labels:</td><td><LabelsField {...props} fieldName="labels" /></td>
                </tr>
            </tbody>
        </Table>
    );
}

function TableNameRow(props: { children: React.ReactNode }) {
    return (
        <Group grow>
            <Box className="h5" sx={(theme: MantineTheme) => ({
                backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[3],
            })}>
                {props.children}
            </Box>
        </Group>
    );
}

function GeneralPane(props: { torrent: Torrent }) {
    return (
        <div className="d-flex flex-column h-100 w-100">
            <Container fluid mx={0}>
                <DownloadBar {...props} />
            </Container>
            <div className="flex-grow-1">
                <div className="scrollable">
                    <Container fluid>
                        <TableNameRow>Transfer</TableNameRow>
                        <TransferTable {...props} />
                        <TableNameRow>Torrent</TableNameRow>
                        <TorrentDetails {...props} />
                    </Container>
                </div>
            </div>
        </div>
    );
}

function FileTreePane(props: { torrent: Torrent }) {
    const fileTree = useMemo(
        () => new CachedFileTree(props.torrent.hashString, props.torrent.id),
        [props.torrent.hashString, props.torrent.id]);

    const { data, refetch } = useFileTree("filetree", fileTree);

    useEffect(() => {
        if (fileTree.initialized) {
            fileTree.update(props.torrent);
        } else {
            fileTree.parse(props.torrent, false);
        }
        void refetch();
    }, [props.torrent, fileTree, refetch]);

    const mutation = useMutateTorrent();

    const onCheckboxChange = useUnwantedFiles(fileTree, true);
    const updateUnwanted = useCallback((entry: FileDirEntry, state: boolean) => {
        onCheckboxChange(entry, state);
        mutation.mutate({
            torrentIds: [props.torrent.id],
            fields: { [state ? "files-wanted" : "files-unwanted"]: fileTree.getChildFilesIndexes(entry.fullpath) },
        });
    }, [fileTree, mutation, onCheckboxChange, props.torrent.id]);

    return (
        <FileTreeTable
            fileTree={fileTree}
            data={data}
            downloadDir={props.torrent.downloadDir}
            onCheckboxChange={updateUnwanted} />
    );
}

function Stats(props: { stats: SessionStatEntry }) {
    return <Table>
        <tbody>
            <tr>
                <td>Downloaded</td><td>{bytesToHumanReadableStr(props.stats.downloadedBytes)}</td>
                <td>Uploaded</td><td>{bytesToHumanReadableStr(props.stats.uploadedBytes)}</td>
            </tr>
            <tr>
                <td>Files added</td><td>{props.stats.filesAdded}</td>
                <td>Active</td><td>{secondsToHumanReadableStr(props.stats.secondsActive)}</td>
            </tr>
            {props.stats.sessionCount > 1
                ? <tr><td>Sesssion count</td><td>{props.stats.sessionCount}</td><td></td><td></td></tr>
                : <></>}
        </tbody>
    </Table>;
}

function ServerStats() {
    const { data: sessionStats } = useSessionStats(true);

    return (
        <div className="d-flex flex-column h-100 w-100">
            <div className="flex-grow-1">
                <div className="scrollable">
                    {sessionStats !== undefined
                        ? <Container fluid>
                            <TableNameRow>Session</TableNameRow>
                            <Stats stats={sessionStats["current-stats"]} />
                            <TableNameRow>Cumulative</TableNameRow>
                            <Stats stats={sessionStats["cumulative-stats"]} />
                        </Container>
                        : <></>
                    }
                </div>
            </div>
        </div>
    );
}

function Details(props: DetailsProps) {
    const { data: torrent } = useTorrentDetails(
        props.torrentId ?? -1, props.torrentId !== undefined && props.updates);

    return (
        <Tabs variant="outline" defaultValue="general" keepMounted={false} className="h-100 d-flex flex-column">
            <Tabs.List px="sm" pt="xs">
                <Tabs.Tab value="general" disabled={torrent === undefined}>
                    <Group>
                        <Icon.InfoCircleFill size={16} />
                        General
                    </Group>
                </Tabs.Tab>
                <Tabs.Tab value="files" disabled={torrent === undefined}>
                    <Group>
                        <Icon.Files size={16} />
                        {`Files${torrent !== undefined ? ` (${torrent.files.length as number})` : ""}`}
                    </Group>
                </Tabs.Tab>
                <Tabs.Tab value="pieces" disabled={torrent === undefined}>
                    <Group>
                        <Icon.Grid3x2 size={16} />
                        {`Pieces${torrent !== undefined ? ` (${torrent.pieceCount as number})` : ""}`}
                    </Group>
                </Tabs.Tab>
                <Tabs.Tab value="peers" disabled={torrent === undefined}>
                    <Group>
                        <Icon.PeopleFill size={16} />
                        Peers
                    </Group>
                </Tabs.Tab>
                <Tabs.Tab value="trackers" disabled={torrent === undefined}>
                    <Group>
                        <Icon.Wifi size={16} />
                        Trackers
                    </Group>
                </Tabs.Tab>
                <Tabs.Tab value="serverstats" ml="auto">
                    <Group>
                        <Icon.ArrowDownUp size={16} />
                        Server statistics
                    </Group>
                </Tabs.Tab>
            </Tabs.List>
            <div className="flex-grow-1">
                <Tabs.Panel value="general" className="h-100">
                    {torrent !== undefined
                        ? <GeneralPane torrent={torrent} />
                        : <></>}
                </Tabs.Panel>
                <Tabs.Panel value="files" className="h-100">
                    {torrent !== undefined
                        ? <FileTreePane torrent={torrent} />
                        : <></>}
                </Tabs.Panel>
                <Tabs.Panel value="pieces" className="h-100">
                    {torrent !== undefined
                        ? <PiecesCanvas torrent={torrent} />
                        : <></>}
                </Tabs.Panel>
                <Tabs.Panel value="peers" className="h-100">
                    {torrent !== undefined
                        ? <PeersTable torrent={torrent} />
                        : <></>}
                </Tabs.Panel>
                <Tabs.Panel value="trackers" className="h-100">
                    {torrent !== undefined
                        ? <TrackersTable torrent={torrent} />
                        : <></>}
                </Tabs.Panel>
                <Tabs.Panel value="serverstats" className="h-100">
                    <ServerStats />
                </Tabs.Panel>
            </div>
        </Tabs>
    );
}

export const MemoizedDetails = memo(Details) as typeof Details;
