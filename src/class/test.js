const NATIVE_HOOKS = [
  // 保持第 0 位，为启动钩子
  'onLaunch',
  'onShow',
  'onHide',

  // onError 不能监听，发生错误的时候，会发生死循环。
  // 'onError',
  'onPageNotFound',
];

/**
 * 按循序执行 Promise 任务
 * @param {Array} options.tasks 要执行的任务队列
 * @param {Host} options.thisIns 宿主实例
 * @param {*} options.arg 透传的参数
 */
function sequenceTasks({ tasks, thisIns, arg }) {
  function recordValue(results, value) {
    results.push(value);
    return results;
  }
  const pushValue = recordValue.bind(null, []);
  return tasks.reduce(
    (promise, task) =>
      promise.then(() => task.apply(thisIns, arg)).then(pushValue),
    Promise.resolve()
  );
}

/**
 * 钩子函数可插件化
 * 1. 对 native Hook 可插件化
 * 2. 对 handler Hook 可插件化
 * @param {String} theHost
 * @param {String} funName
 */
function hookFunPluggablify({ theHost, funName, beforeCall }) {
  // initializeize function queue (overwrite pluggabled function)
  theHost.newHookFunQueue(funName);

  // 避免重复改造，造成无限递归
  if (theHost[funName] && theHost[funName].isPluggableHookFun) {
    logger.warn(
      `hook function(${funName}) has been pluggabled, do not allow repetition.`
    );
    return;
  }

  // 标记 isPluggableHookFun，避免重复改造，造成无限递归。
  theHost[funName] = Object.defineProperty(
    function pluggableHookFun(...arg) {
      const _theHost = this;
      
      if (typeof beforeCall === 'function') beforeCall({ theHost: _theHost });

      const funQueue = _theHost.getHookFunQueue(funName);

      // 如果不存在，则 resolve
      if (!funQueue || !Array.isArray(funQueue)) return Promise.resolve();

      // 以 「先进先出」 的形式按顺序执行 Promise 链，未捕捉的错误，扔到 onError 去。
      return sequenceTasks({
        tasks: funQueue,
        thisIns: _theHost,
        arg,
      }).catch(err => {
        if (typeof _theHost.onError === 'function') {
          _theHost.onError(err);
        }
        throw err;
      });
    },
    'isPluggableHookFun',
    { value: true }
  );
}

class Host {
  constructor({ nativeHookNames = [], launchHookName }) {
    // new a domain space
    this._btPlugin = {
      nativeHookNames,

      // 存放 attached plugin info
      plugins: [],

      // 存放插件化的函数队列（native hook & handler hook）
      // （这个队列里面的方法，会在对应的钩子函数触发的时候被执行，参数：this => theHost，以及原有参数透传）
      pluggableFunQueueMap: {},

      // 存放每个插件的 initialize 方法，
      // （这个队列里面的方法，会在 onLoad,onLaunch 的时候会已同步的形式执行，参数：{ theHost } ）
      pluginsInitializeQueue: [],
    };

    nativeHookNames.forEach(funName => {
      if (funName === launchHookName) {
        // custom method pluggable
        hookFunPluggablify({
          theHost: this,
          funName,
          beforeCall({ theHost }) {
            theHost.getInitFunQueue().forEach(task => task({ theHost }));
          },
        });
      } else {
        // hook function pluggable
        hookFunPluggablify({ theHost: this, funName });
      }
    });
  }

  pushHookFun = (funName, func) => {
    this._btPlugin.pluggableFunQueueMap[funName].push(func);
  };
  getHookFunQueue = funName => this._btPlugin.pluggableFunQueueMap[funName];
  newHookFunQueue = funName => {
    this._btPlugin.pluggableFunQueueMap[funName] = [];
  };
  getInitFunQueue = () => this._btPlugin.pluginsInitializeQueue;
}

class BtApp extends Host {
  constructor(content) {
    super({ nativeHookNames: NATIVE_HOOKS, launchHookName: NATIVE_HOOKS[0] });
    if (content) {
      Object.keys(content).forEach(key => {
        if (NATIVE_HOOKS.includes(key)) {
          // register native hook function
          if (typeof content[key] === 'function') {
            this.pushHookFun(key, content[key]);
          }
        } else {
          // protected domain check
          if (this[key] !== undefined) {
            throw new Error(`you can't use protected domain: ${key} at BtApp`);
          }
          this[key] = content[key];
        }
      });
    }
  }
}

const a = new BtApp({
  onLaunch() {
    console.log('调试onlaunch');
  }
});
a.onLaunch()
