'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as shelljs from 'shelljs';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-smash" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    const subscriptions = [
        vscode.commands.registerCommand('extension.attachToPod', attachToPod),
        vscode.commands.registerCommand('extension.addApp', addApplication),
        vscode.commands.registerCommand('extension.deletePod', deletePod),
        vscode.commands.registerCommand('extension.waitForBreakpoint', waitForBreakpoint),
    ];


    subscriptions.forEach((element) => {
        context.subscriptions.push(element);
    }, this);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

interface ClockInterface {
    currentTime: Date;
}

class PodPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    pod: any;

    constructor(pod: any) {
        let podname = pod["metadata"]["name"];
        let nodename  = pod["spec"]["nodeName"];
        this.label = `${podname} (${nodename})`;
        this.description = "pod" ;
        this.pod = pod;
     }
}

class ContainerPickItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail?: string;

    container: any;

    constructor(container: any) {
        this.label = container["name"] + " - " + container["image"];
        this.description =  "container";
        this.container = container;
     }
}


function selectPod() : Promise<any> {
     return getPods().then( (pods) => {

        let podItems : PodPickItem[] = [];
        for (let pod of pods) {
            podItems.push(new PodPickItem(pod));
        }

        return vscode.window.showQuickPick(podItems).then((item) => {
            if (item) {
                return item.pod;
            } else {
                return undefined;
            }
        });
});
}

function deletePod() : Promise<any> {
     return selectPod().then( (pod) => {
        if (pod) {
            let podname = pod["metadata"]["name"];
            return kubectl(`delete pod ${podname}`)
        }
     }).catch(handleError);
}

function selectContainer(pod) : Promise<any> {

    let containerItems : ContainerPickItem[] = [];
    let selectedpod =  pod;
    for (let container of selectedpod["spec"]["containers"]) {
        containerItems.push(new ContainerPickItem(container))
    }

    return new Promise<ContainerPickItem>((resolve, reject) => {
        vscode.window.showQuickPick(containerItems).then((item) => {resolve(item);});
    }).then((item) => {
            if (item) {
                return item.container;
            } else {
                return undefined;
            }
        });
}


function chooseImage() : Promise<string> {
    const custom = "-- custom --";
    
    return getImages().then((images) => {
        images.push(custom);
        return vscode.window.showQuickPick(images);
    }).then((image) => {
        if (image) {
            if (image == custom) {
                return vscode.window.showInputBox().then(
                    (img) => {
                        if (img) {
                            return img;
                        }
                    }
                );
            } else {
                return image;         
            }
        }
    });
}

function syncBreakpoints() {
    return chooseImage().then((img) => {
       // vscode.
    });
}

function waitForBreakpoint() {
    return chooseImage().then((img) => {
        waitForAttachment(img, null).then((remote) => {
            return waitAndDebug(img, null);
        });
    });
}

function addApplication() {
    const custom = "-- custom --";
    
    let promise = chooseImage().then((img) => {
        if (img) {
            return dbgclient(`app add "${img}"`);
        }
    });

    return promise.catch(handleError);
}

const handleError = (err) => {
    if (err) {
        vscode.window.showErrorMessage(err.message);
    }
};

function attachToPod() {
    // ask the user to chose a pod
    // and image id

    let containerPromise = selectPod().then((pod) => {
        if (pod) {
            return selectContainer(pod).then((container) => {
                if (container) {
                    let containerimage = container["image"];
                    let containername = container["name"];
                    let podname = pod["metadata"]["name"];
                    console.log(`running debug container ${containerimage}, ${podname}, ${containername}`);
                    return _debugContainer(containerimage, podname, containername);
                }
            });
        }
    });

    containerPromise.catch(handleError);

}

function getImages() : Promise<string[]> {
    return exec("docker images --format '{{.Repository}}:{{.Tag}}' --filter='dangling=false' -q").then((output) => {
        let output2 : string[] =  output.split("\n");
        output2 = output2.filter(v => v!='');
        return output2;
    });
}

function registerApp(imageid, breakpoints) {

}

function debugContainer(imageid, pod) {
    // TODO: verify that coontainer exist and image id matches app
    // or perhaps not request container at all..

    findcontainer(imageid, pod).then(
        (container) => {
            _debugContainer(imageid, pod, container);
        }
    );
}

function waitAndDebug(imageid, token) {
    return waitForAttachment(imageid, token).then((remote) => {
        console.log(`Attachment waited! image, token: "${imageid}" "${token}";remote: ${remote}`);
        // TODO: create a real forwarder and close it in the end.
        return kubectl_portforward(remote).then(
        (number) => {
            console.log("Local port forward for debug server is: localhost:"+number);
            vscode.window.showInformationMessage('Starting debug session' + remote);

            return vscode.commands.executeCommand(
                'vscode.startDebug',
                {
                    "name": "Remote",
                    "type": "go",
                    "request": "launch",
                    "mode": "remote",
                    "port": number,
                    "host": "127.0.0.1",
                    "program": "${workspaceRoot}",
                    "env": {},
                    "args": [],
                    "showLog": true
                }
                /*
                {
                    type: "gdb",
                    request: "attach",
                    name: "Attach to gdbserver",
                //  executable: vscode.workspace.rootPath + "/target/debug/buggy",
                    target: "localhost:"+number,
                    remote: true,
                    cwd: vscode.workspace.rootPath
                }
                */
            );
            
        });
        });
}

function _debugContainer(imageid, pod, container) {
    return requestAttachment(imageid, pod, container).then(
        (token) => {
            if (token) {
                console.log(`requestAttachment token ${token}`);
                return waitAndDebug(imageid, token);
            }
            throw new Error('Attachment token not found');
            
        }).catch(handleError);

}

function getPods(): Promise<any> {
    return kubectl_get("pods").then((podsjson) => {
            return podsjson["items"];
    });
}

function findcontainer(imageid, podname): Promise<string> {
    return getPods().then((pods) => {
        for (let pod of pods) {
            if (pod["metadata"]["name"] == podname) {
                for (let container of pod["spec"]["containers"]) {
                    if (imageid == container["image"]) {
                        console.log("found container" + container["name"]);
                        return container["name"]
                    }
                }
                throw new Error('Container not found');
            }
        }
        throw new Error('Pod not found');
    });
}

function requestAttachment(imgid, pod, container): Promise<string> {
    console.log(`requestAttachment ${imgid}, ${pod}, ${container}`);
    
    return dbgclient(`app attach ${imgid} ${pod} ${container} dlv`).then((res) => {
        return res["id"];
    });
}
function waitForAttachment(imgid, token): Promise<string> {
    let deadline = process.hrtime();
    deadline[0] += 60;
    return _waitForAttachmentDeadline(token, deadline)
}

function _waitForAttachmentDeadline(token, deadline): Promise<string> {
    let waitcmd = `session  wait ${token}`;

    return dbgclient(waitcmd).then((res) => {
        console.log(`Wait returned: ${res}`)
        return res["url"];
    }).catch((err) => {
        let errinfojson = JSON.parse(err.stderr);
        if (errinfojson["Type"] == "Timeout") {
            let nowtime = process.hrtime();
            if (nowtime[0] > deadline[0]) {
                throw err;
            }
            return _waitForAttachmentDeadline(token, deadline)
        }
        throw err;
    });
}

function portforward(port, remote) {
    let remoteparts = remote.split(":");
    if (remoteparts.length != 2) {
        throw new Error('Invalid remote');
    }
    let pod = remoteparts[0];
    let podport = remoteparts[1];

    // exec async..
    kubectl(`port-forward ${pod} ${port}:${podport}`).catch(handleError);

}

function kubectl_get(cmd): Promise<any> {
    return kubectl("get -o json " + cmd).then(JSON.parse);
}

function kubectl(cmd): Promise<any> {
    setproxy();
    
    return exec(get_conf_or("kubectl-path","kubectl") + " " + cmd);
}


function get_conf_or(k,d) {
    let config = vscode.workspace.getConfiguration('vs-squash');
    let v = config[k];
    if (!v) {
        return d;
    }
    return v;
}

function setproxy() {


    let proxy = get_conf_or("kubectl-proxy","");
    if (proxy) {
        shelljs.env["http_proxy"] = proxy;
    }
}

function kubectl_portforward(remote) : Promise<number> {
    let remoteparts = remote.split(":");
    if (remoteparts.length != 2) {
        throw new Error('Invalid remote');
    }
    let pod = remoteparts[0];
    let podport = remoteparts[1];

    setproxy();

    let cmd = get_conf_or("kubectl-path","kubectl") + " port-forward " + ` ${pod} :${podport}`;
    console.log("Executing: " + cmd);
    let p = new Promise<number>((resolve, reject) => {
        let resolved = false;
        let handler = function (code, stdout, stderr) {
            if (resolved != true) {
                if (code !== 0) {
                    reject(new ExecError(code, stderr));
                } else {
                    reject(new Error("Didn't receive port"));
                }
            } else {
                    console.log(`port forward ended unexpectly: ${code} ${stdout} ${stderr}`)
            }
        };
        let child = shelljs.exec(cmd, handler);
        let stdout = "";
        child.stdout.on('data', function(data) {
            stdout += data;
            let portRegexp = /from\s+.+:(\d+)\s+->/g;
            let match = portRegexp.exec(stdout);
            if (!match != null) {
                resolved = true;
                resolve(parseInt(match[1]))
            }
        });
    });

    return p;
}

function dbgclient(cmd): Promise<any> {
    let url = get_conf_or("dbgserver-url","");

    if (url) {
        url = " --url="+url
    }

    return exec(get_conf_or("dbgclient-path","dbgclient")  + url + " --json=true " + cmd).then(JSON.parse);
}

function exec(cmd): Promise<any> {
    console.log("Executing: " + cmd);
    return new Promise((resolve, reject) => {
        let handler = function (code, stdout, stderr) {
            if (code !== 0) {
                reject(new ExecError(code, stderr));
            } else {
                resolve(stdout);
            }
        };
        shelljs.exec(cmd, handler);
    });
}

// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
class ExecError extends Error {
    code : number;
    stderr : string;

    constructor(code : number, stderr : string) {
        super(stderr.trim());

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ExecError.prototype);

        this.code = code;
        this.stderr = stderr;
    }

    getCode() {
        return this.code;
    }

    getStderr() {
        return this.stderr;
    }

}


