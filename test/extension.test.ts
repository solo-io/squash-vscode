//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../src/extension';

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", () => {

    test("RemoteDebuggerAddress parses correctly", () => {
        let rda = new myExtension.RemoteDebuggerAddress("pod.namespace:123");

        assert.equal("pod", rda.podName);
        assert.equal("namespace", rda.podNamespace);
        assert.equal("123", rda.port);
    });

    test("RemoteDebuggerAddress parses default namespace", () => {
        let rda = new myExtension.RemoteDebuggerAddress("pod:123");

        assert.equal("pod", rda.podName);
        assert.equal("squash", rda.podNamespace);
        assert.equal("123", rda.port);
    });

    test("RemoteDebuggerAddress throws on bad format", () => {

        assert.throws(() => {new myExtension.RemoteDebuggerAddress("unknown")});
        assert.throws(() => {new myExtension.RemoteDebuggerAddress("another.unknown")});
    });
});